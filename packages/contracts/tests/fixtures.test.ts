import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import animationIntentSchema from "../schema/animation-intent.schema.json";
import partnerStateSnapshotSchema from "../schema/partner-state-snapshot.schema.json";
import runtimeDescriptorSchema from "../schema/runtime-descriptor.schema.json";
import workflowEventSchema from "../schema/workflow-event.schema.json";
import {
  workflowEventFromWire,
  workflowEventToWire,
  snapshotFromWorkflowEvent,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  type WorkflowEventWire
} from "../src";

const fixtureRoot = new URL("../fixtures/", import.meta.url);

const schemaByPrefix = [
  ["workflow-event", workflowEventSchema],
  ["partner-state-snapshot", partnerStateSnapshotSchema],
  ["animation-intent", animationIntentSchema],
  ["runtime-descriptor", runtimeDescriptorSchema]
] as const;

function readJsonFixture(kind: "valid" | "invalid", fileName: string): unknown {
  return JSON.parse(readFileSync(new URL(`${kind}/${fileName}`, fixtureRoot), "utf8"));
}

function schemaForFixture(fileName: string) {
  const match = schemaByPrefix.find(([prefix]) => fileName.startsWith(prefix));
  if (!match) {
    throw new Error(`No schema mapping for fixture ${fileName}`);
  }
  return match[1];
}

function fixtureNames(kind: "valid" | "invalid"): string[] {
  return readdirSync(new URL(kind, fixtureRoot))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

describe("contract fixtures", () => {
  it.each(fixtureNames("valid"))("accepts valid fixture %s", (fileName: string) => {
    const validate = ajv.compile(schemaForFixture(fileName));
    const payload = readJsonFixture("valid", fileName);

    expect(validate(payload), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it.each(fixtureNames("invalid"))("rejects invalid fixture %s", (fileName: string) => {
    const validate = ajv.compile(schemaForFixture(fileName));
    const payload = readJsonFixture("invalid", fileName);

    expect(validate(payload), `${fileName} unexpectedly validated`).toBe(false);
  });

  it("keeps snake_case wire payloads and camelCase domain objects at the boundary", () => {
    const wire = readJsonFixture(
      "valid",
      "workflow-event-reading.json"
    ) as WorkflowEventWire;

    const domain = workflowEventFromWire(wire);

    expect(domain).toEqual({
      schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
      eventId: "evt_20260602_0001",
      source: "codex-wrapper",
      runId: "run_abc123",
      workflowState: "reading",
      timestamp: "2026-06-02T00:00:00Z",
      message: "正在读取项目内容",
      codeContextAllowed: false
    });
    expect(workflowEventToWire(domain)).toEqual(wire);
  });

  it("derives a minimal snapshot fixture shape from workflow events", () => {
    const wire = readJsonFixture(
      "valid",
      "workflow-event-waiting.json"
    ) as WorkflowEventWire;

    expect(snapshotFromWorkflowEvent(workflowEventFromWire(wire))).toMatchObject({
      workflowState: "waiting",
      priority: "high",
      source: "cli",
      runId: "run_abc123",
      activeRunId: "run_abc123",
      paused: false,
      connection: "ok"
    });
  });

  it("keeps partner snapshots single-active instead of exposing a card queue", () => {
    const validate = ajv.compile(partnerStateSnapshotSchema);
    const snapshot = readJsonFixture(
      "valid",
      "partner-state-snapshot-reading.json"
    ) as Record<string, unknown>;

    expect(validate(snapshot), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(snapshot).toMatchObject({
      runId: "run_abc123",
      activeRunId: "run_abc123"
    });
    expect(snapshot).not.toHaveProperty("cards");
    expect(snapshot).not.toHaveProperty("queue");
    expect(snapshot).not.toHaveProperty("workflows");
  });

  it("has fixture names covered by schema prefixes", () => {
    for (const fileName of [...fixtureNames("valid"), ...fixtureNames("invalid")]) {
      expect(() => schemaForFixture(fileName), basename(join("fixtures", fileName))).not.toThrow();
    }
  });
});
