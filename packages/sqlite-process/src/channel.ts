export type RowValue = string | number | null;
export type ProjectionWrite = readonly string[] | 'effects';

export type RowProjection = {
  readonly id: string;
  readonly table: string;
  readonly keys: readonly string[];
  readonly columns: readonly string[];
  readonly address?: string;
  readonly context?: readonly string[];
};

export type RowChange = {
  readonly projection: string;
  readonly kind: 'insert' | 'update' | 'delete';
  readonly key: readonly RowValue[];
  readonly address: RowValue;
  readonly before: RowValue;
  readonly values: Readonly<Record<string, RowValue>>;
};

export type RowSelection = {
  readonly id: string;
  readonly sql: string;
  readonly columns: readonly string[];
  readonly sources: readonly { readonly projection: string; readonly columns: readonly string[]; readonly when?: string }[];
};

export type RowDeclarations = { readonly rows: readonly RowProjection[]; readonly selections: readonly RowSelection[] };

export type SelectedRow = {
  readonly selection: string;
  readonly key: RowValue;
  readonly values: Readonly<Record<string, RowValue>> | null;
};
export type SelectionWork = { readonly selection: string; readonly execMs: number; readonly rows: number; readonly program?: number };

export type RowCommit = {
  readonly incarnation: string;
  readonly cursor: number;
  readonly bytes: number;
} & (
  | { readonly _tag: 'Complete'; readonly changes: readonly RowChange[]; readonly selected: readonly SelectedRow[] }
  | { readonly _tag: 'Gap' }
);

export const PROJECTION_CLOCK = '__row_projection_clock';
export const PROJECTION_BYTES = 1_048_576;

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
      readonly projections?: ProjectionWrite;
    }
  | {
      readonly _tag: 'Project';
      readonly id: number;
      readonly projections: readonly RowProjection[];
      readonly selections: readonly RowSelection[];
      readonly reset?: boolean;
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
  readonly safeIntegers?: boolean;
};

export type SqliteProgram = {
  readonly statements: ReadonlyArray<ProgramStatement>;
  readonly projections?: ProjectionWrite;
};

export type ReturnedRows = ReadonlyArray<ReadonlyArray<unknown>>;

export type ProgramOutcome =
  | { readonly _tag: 'Applied'; readonly execMs: number; readonly returned?: ReadonlyArray<ReturnedRows>; readonly rows?: RowCommit }
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
      readonly commits?: readonly RowCommit[];
      readonly projectionWork?: readonly SelectionWork[];
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
      readonly projectionWork?: readonly SelectionWork[];
    }
  | {
      readonly _tag: 'Failed';
      readonly id: number;
      readonly thrown: ThrownShape;
      readonly queueMs: number;
      readonly execMs: number;
      readonly projectionWork?: readonly SelectionWork[];
    };

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
