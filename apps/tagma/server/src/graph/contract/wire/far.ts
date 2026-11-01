import { Schema } from 'effect';
import { BlockIdentity, BlockName } from './references.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const FAR_TO = new RegExp(`^(${UUID})/(${UUID})(?:#([\\s\\S]*))?$`, 'u');

export const graphAddressSchema = Schema.Struct({ graph: Schema.String, label: Schema.String });
export type GraphAddress = typeof graphAddressSchema.Type;

export type FarAddress = { readonly graph: string; readonly uuid: string };

export type FarTarget = FarAddress & { readonly label: string };

export const farKey = (target: FarAddress): string => `${target.graph}/${target.uuid}`;

export const farText = (target: FarTarget): string => `${farKey(target)}${target.label === '' ? '' : `#${target.label}`}`;

export function farOf(to: string): FarTarget | null {
  const found = FAR_TO.exec(to);
  return found === null ? null : { graph: found[1]!, uuid: found[2]!, label: found[3] ?? '' };
}

export const PHASES = ['initial', 'active', 'terminal'] as const;
export type Phase = (typeof PHASES)[number];

const tagWordsSchema = Schema.Struct({ tag: Schema.String, name: Schema.String, words: Schema.Array(Schema.String) });

export const phaseWordsSchema = Schema.Struct({
  revision: Schema.String,
  contracts: Schema.Record(
    Schema.String,
    Schema.Struct({ initial: Schema.Array(tagWordsSchema), active: Schema.Array(tagWordsSchema), terminal: Schema.Array(tagWordsSchema) }),
  ),
});
export type PhaseWords = typeof phaseWordsSchema.Type;

export const FAR_STATES = ['here', 'absent', 'ambiguous'] as const;
export type FarStateKind = (typeof FAR_STATES)[number];

export const farEndSchema = Schema.Struct({
  project: Schema.String,
  projectId: Schema.NullOr(Schema.Number),
  state: Schema.Literals(FAR_STATES),
  title: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
});
export type FarEnd = typeof farEndSchema.Type;

export const refElsewhereSchema = Schema.Struct({
  name: BlockName,
  identity: BlockIdentity,
  project: Schema.String,
  projectId: Schema.Number,
  branch: Schema.NullOr(Schema.String).annotate({ description: 'The worktree branch holding the block, null for the main checkout.' }),
});
export type RefElsewhere = typeof refElsewhereSchema.Type;

export const pointingSchema = Schema.Struct({
  edges: Schema.Number,
  holding: Schema.Number,
  byProject: Schema.Array(
    Schema.Struct({ project: Schema.String, projectId: Schema.Number, edges: Schema.Number, holding: Schema.Number }),
  ),
  unread: Schema.Array(Schema.String),
}).annotate({
  description:
    'Edges from other projects of this machine into this graph; holding counts the ones that hold open work back. Projects whose index could not be read, or whose open work could not be judged, are named in unread.',
});
export type Pointing = typeof pointingSchema.Type;

export const farHoldSchema = Schema.Struct({
  project: Schema.String,
  tasks: Schema.Array(BlockName),
  code: Schema.Literal('target-absent'),
  reason: Schema.String,
  unblock: Schema.Array(Schema.String),
}).annotate({
  description: 'Open work held back by a blocker this machine cannot read: its project is absent here, or two projects carry its graph.',
});
export type FarHold = typeof farHoldSchema.Type;
