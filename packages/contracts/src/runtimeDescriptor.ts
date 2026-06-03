import { RUNTIME_DESCRIPTOR_SCHEMA_VERSION } from "./versions";

export interface RuntimeDescriptor {
  schemaVersion: typeof RUNTIME_DESCRIPTOR_SCHEMA_VERSION;
  appInstanceId: string;
  pid: number;
  port: number;
  token: string;
  createdAt: string;
}
