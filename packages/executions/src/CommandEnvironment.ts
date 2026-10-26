import { Data, type Effect, Schema } from 'effect';
import { EffectiveEnvironment, EnvironmentEntry } from './protocol/execution';

export const CommandEnvironmentRequest = Schema.Struct({
  inherit: Schema.Boolean,
  entries: Schema.Array(EnvironmentEntry),
});
export type CommandEnvironmentRequest = typeof CommandEnvironmentRequest.Type;

export class CommandEnvironmentUnavailable extends Data.TaggedError('CommandEnvironmentUnavailable')<{
  readonly reason: string;
}> {}

export type CommandEnvironment = {
  readonly materialize: (request: CommandEnvironmentRequest) => Effect.Effect<EffectiveEnvironment, CommandEnvironmentUnavailable>;
};

export const resolveEnvironment = (bound: ReadonlyMap<string, string>, request: CommandEnvironmentRequest): EffectiveEnvironment => {
  const resolved = new Map(request.inherit ? bound : []);
  for (const entry of request.entries) {
    switch (entry._tag) {
      case 'Set':
        resolved.set(entry.name, entry.value);
        break;
      case 'Unset':
        resolved.delete(entry.name);
        break;
      case 'Default':
        if (!resolved.has(entry.name)) resolved.set(entry.name, entry.value);
        break;
      case 'UnsetIf':
        if (resolved.get(entry.name) === entry.value) resolved.delete(entry.name);
        break;
    }
  }
  return [...resolved].map(([name, value]) => ({ name, value }));
};
