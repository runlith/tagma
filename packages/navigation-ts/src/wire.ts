import { Judging, Problem, Spot } from '@runlith/navigation/adapter';
import { Schema } from 'effect';

export const Asked = Schema.Union([Schema.TaggedStruct('locate', { spot: Spot }), Schema.TaggedStruct('judge', { judging: Judging })]);
export type Asked = typeof Asked.Type;

export const Asking = Schema.Struct({ checkout: Schema.String, revision: Schema.String, asked: Asked });
export type Asking = typeof Asking.Type;

export const Dropped = Schema.Struct({ checkout: Schema.String, revision: Schema.String });

export const Attached = Schema.Struct({ checkout: Schema.String });

export const Touched = Schema.Struct({
  checkout: Schema.String,
  seq: Schema.Int,
  touch: Schema.Union([
    Schema.TaggedStruct('paths', { paths: Schema.Array(Schema.String) }),
    Schema.TaggedStruct('head', {}),
    Schema.TaggedStruct('rescan', {}),
  ]),
});
export type Touched = typeof Touched.Type;

export const Cancelled = Schema.Struct({ id: Schema.Int });

export const Limited = Schema.Struct({ bytes: Schema.Finite });

export const Standing = Schema.Struct({
  checkout: Schema.String,
  revision: Schema.String,
  absorbed: Schema.Int,
  known: Schema.Boolean,
  warming: Schema.Boolean,
  problems: Schema.Array(Problem),
  changed: Schema.Array(Schema.String),
});
export type Standing = typeof Standing.Type;

export const Drifted = Schema.Struct({ checkout: Schema.String, seq: Schema.Int, paths: Schema.Array(Schema.String) });
export type Drifted = typeof Drifted.Type;

export const Refused = Schema.Struct({ checkout: Schema.String, detail: Schema.String });
export type Refused = typeof Refused.Type;

export const METHODS = {
  ask: 'ask',
  touch: 'touch',
  cancel: 'cancel',
  drop: 'drop',
  attach: 'attach',
  detach: 'detach',
  rest: 'rest',
  limit: 'limit',
  standing: 'standing',
  drifted: 'drifted',
  refused: 'refused',
} as const;
