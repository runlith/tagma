export type SqliteRequest = { readonly connection: number; readonly ask: SqliteAsk };
export type SqliteReply = { readonly connection: number; readonly said: SqliteSaid };

export type SqliteAsk =
  | { readonly _tag: 'Open'; readonly id: number; readonly config: OpenConfig }
  | {
      readonly _tag: 'Run';
      readonly id: number;
      readonly shape: 'rows' | 'values';
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
      readonly safeIntegers: boolean;
      readonly sentAt: number;
    }
  | { readonly _tag: 'Export'; readonly id: number }
  | { readonly _tag: 'LoadExtension'; readonly id: number; readonly path: string }
  | { readonly _tag: 'Close'; readonly id: number }
  | { readonly _tag: 'Ping'; readonly id: number }
  | { readonly _tag: 'Maintain'; readonly id: 0 }
  | { readonly _tag: 'Checkpoint'; readonly id: number; readonly filename: string; readonly durable: boolean };

export type SqliteSaid =
  | { readonly _tag: 'Rows'; readonly id: number; readonly rows: ReadonlyArray<unknown>; readonly queueMs: number; readonly execMs: number }
  | { readonly _tag: 'Exported'; readonly id: number; readonly bytes: Uint8Array }
  | { readonly _tag: 'Did'; readonly id: number }
  | { readonly _tag: 'Maintaining'; readonly id: 0 }
  | { readonly _tag: 'Changed'; readonly id: 0; readonly filename: string }
  | { readonly _tag: 'CheckpointFailed'; readonly id: 0; readonly filename: string; readonly thrown: ThrownShape }
  | { readonly _tag: 'Checkpointed'; readonly id: number; readonly log: number; readonly copied: number }
  | { readonly _tag: 'Failed'; readonly id: number; readonly thrown: ThrownShape; readonly queueMs: number; readonly execMs: number };

export type OpenConfig = {
  readonly filename: string;
  readonly readonly: boolean;
  readonly create: boolean;
  readonly readwrite: boolean;
  readonly disableWAL: boolean;
  readonly durable: boolean;
  readonly busyTimeoutMs: number;
  readonly mmapBytes: number;
};

export type ThrownShape = {
  readonly name: string;
  readonly message: string;
  readonly code: string | number | undefined;
  readonly errno: number | undefined;
  readonly constraint: string | undefined;
};

export const thrownShapeOf = (cause: unknown): ThrownShape => {
  const held = (cause ?? {}) as Record<string, unknown>;
  return {
    name: typeof held.name === 'string' ? held.name : 'Error',
    message: typeof held.message === 'string' ? held.message : String(cause),
    code: typeof held.code === 'string' || typeof held.code === 'number' ? held.code : undefined,
    errno: typeof held.errno === 'number' ? held.errno : undefined,
    constraint: typeof held.constraint === 'string' ? held.constraint : undefined,
  };
};
