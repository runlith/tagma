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
  | { readonly _tag: 'Checkpoint'; readonly id: number; readonly filename: string; readonly durable: boolean }
  | ({ readonly _tag: 'Programs'; readonly id: number; readonly sentAt: number } & ProgramBatch);

export type Synchronous = 'off' | 'normal' | 'full';

export type ProgramBatch = {
  readonly programs: ReadonlyArray<SqliteProgram>;
  readonly synchronous: Synchronous | null;
};

export type Committed = Extract<SqliteSaid, { readonly _tag: 'Committed' }>;

type ProgramStatement = {
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
  readonly counts: 'rows' | 'changes' | 'returned';
  readonly expect: number | null;
};

export type SqliteProgram = { readonly statements: ReadonlyArray<ProgramStatement> };

export type ReturnedRows = ReadonlyArray<ReadonlyArray<unknown>>;

export type ProgramOutcome =
  | { readonly _tag: 'Applied'; readonly execMs: number; readonly returned?: ReadonlyArray<ReturnedRows> }
  | {
      readonly _tag: 'Conflict';
      readonly statement: number;
      readonly expected: number;
      readonly actual: number;
      readonly execMs: number;
    }
  | { readonly _tag: 'Refused'; readonly statement: number; readonly thrown: ThrownShape; readonly execMs: number };

export type SqliteSaid =
  | {
      readonly _tag: 'Rows';
      readonly id: number;
      readonly rows: ReadonlyArray<unknown>;
      readonly queueMs: number;
      readonly execMs: number;
      readonly commitReturnedAt?: number;
    }
  | { readonly _tag: 'Exported'; readonly id: number; readonly bytes: Uint8Array }
  | { readonly _tag: 'Did'; readonly id: number }
  | { readonly _tag: 'Maintaining'; readonly id: 0 }
  | { readonly _tag: 'Changed'; readonly id: 0; readonly filename: string }
  | { readonly _tag: 'CheckpointFailed'; readonly id: 0; readonly filename: string; readonly thrown: ThrownShape }
  | { readonly _tag: 'Checkpointed'; readonly id: number; readonly log: number; readonly copied: number }
  | {
      readonly _tag: 'Committed';
      readonly id: number;
      readonly outcomes: ReadonlyArray<ProgramOutcome>;
      readonly queueMs: number;
      readonly execMs: number;
      readonly commitReturnedAt: number;
    }
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
