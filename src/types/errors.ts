export enum CharlotteErrorCode {
  ELEMENT_NOT_FOUND = "ELEMENT_NOT_FOUND",
  ELEMENT_NOT_INTERACTIVE = "ELEMENT_NOT_INTERACTIVE",
  NAVIGATION_FAILED = "NAVIGATION_FAILED",
  TIMEOUT = "TIMEOUT",
  EVALUATION_ERROR = "EVALUATION_ERROR",
  SESSION_ERROR = "SESSION_ERROR",
  SNAPSHOT_EXPIRED = "SNAPSHOT_EXPIRED",
}

export class CharlotteError extends Error {
  constructor(
    public readonly code: CharlotteErrorCode,
    message: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "CharlotteError";
  }

  toResponse(): {
    error: { code: string; message: string; suggestion?: string };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.suggestion ? { suggestion: this.suggestion } : {}),
      },
    };
  }
}
