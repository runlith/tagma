export interface StreamRefusal {
  readonly code: string | undefined;
  readonly message: string;
}

export interface StreamRefusalVerdict {
  readonly retryable: boolean;
}

export type StreamRefusalPolicy = (refusal: StreamRefusal) => StreamRefusalVerdict | null;
