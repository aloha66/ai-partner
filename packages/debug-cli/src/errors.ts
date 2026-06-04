export class DebugCliError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "DebugCliError";
  }
}

export function asDebugCliError(error: unknown): DebugCliError {
  if (error instanceof DebugCliError) {
    return error;
  }
  if (error instanceof Error) {
    return new DebugCliError(error.message, "unexpected_error");
  }
  return new DebugCliError(String(error), "unexpected_error");
}
