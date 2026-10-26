import { Context, Data, type Effect, Schema, type Scope } from 'effect';
import { Ask, At } from './question';
import { Place, Position, Verdict } from './verdict';

export const Capability = Schema.Struct({
  language: Schema.String,
  extensions: Schema.Array(Schema.String),
  manifests: Schema.Array(Schema.String),
  asks: Schema.Array(Ask),
});
export type Capability = typeof Capability.Type;

export const Spot = Schema.Union([
  At,
  Schema.TaggedStruct('member', {
    owner: Schema.Struct({ path: Schema.String, line: Position.fields.line, name: Schema.String }),
    member: Schema.String,
  }),
]);
export type Spot = typeof Spot.Type;

export const Resolved = Schema.Struct({
  name: Schema.String,
  line: Position.fields.line,
  declarations: Schema.Array(Place),
});
export type Resolved = typeof Resolved.Type;

export const Subject = Schema.Struct({ id: Schema.String, ...Resolved.fields });
export type Subject = typeof Subject.Type;

export const Located = Schema.Struct({ subjects: Schema.Array(Subject), resolved: Schema.Boolean });
export type Located = typeof Located.Type;

export const Judging = Schema.Struct({ subject: Schema.String, positions: Schema.Array(Position) });
export type Judging = typeof Judging.Type;

export const Judgement = Schema.Struct({
  verdicts: Schema.Array(Verdict),
  aliases: Schema.Array(Subject),
  basis: Schema.Array(Schema.String),
});
export type Judgement = typeof Judgement.Type;

export const PROBLEMS = ['config', 'degraded', 'dependencies', 'generated'] as const;
export const Problem = Schema.Struct({
  project: Schema.String,
  problem: Schema.Literals(PROBLEMS),
  detail: Schema.String,
});
export type Problem = typeof Problem.Type;

export const Snapshot = Schema.Struct({
  revision: Schema.String,
  changed: Schema.Array(Schema.String),
  problems: Schema.Array(Problem),
});
export type Snapshot = typeof Snapshot.Type;

export class EngineLost extends Data.TaggedError('EngineLost')<{ readonly detail: string }> {
  override get message(): string {
    return `the navigation engine ended before it answered: ${this.detail}`;
  }
}

export class EngineFailed extends Data.TaggedError('EngineFailed')<{ readonly detail: string }> {
  override get message(): string {
    return `the navigation engine of this checkout cannot answer: ${this.detail}`;
  }
}

export class EngineDisabled extends Data.TaggedError('EngineDisabled')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export type Adapter = {
  readonly locate: (spot: Spot) => Effect.Effect<Located, EngineLost>;
  readonly judge: (judging: Judging) => Effect.Effect<Judgement, EngineLost>;
};

export type Engine = {
  readonly capability: Capability;
  readonly snapshot: Snapshot;
  readonly warming: boolean;
  readonly adapter: Adapter;
};

export class Engines extends Context.Service<
  Engines,
  {
    readonly lease: (root: string) => Effect.Effect<Engine, EngineFailed | EngineDisabled, Scope.Scope>;
  }
>()('@runlith/navigation/Engines') {}
