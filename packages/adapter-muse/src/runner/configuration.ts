import { Effect, FileSystem, Schema } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { HostedListedSchema } from '@runlith/hosted-runner/door';
import { keepState, keptState, type MusePlace } from './home.js';

const Configuration = Schema.Struct({
  prompt: Schema.String,
  web: Schema.Literals(['vendor', 'none']),
  listed: HostedListedSchema,
});
export type Configuration = typeof Configuration.Type;

const sameSelection = (kept: Configuration, want: Configuration) => {
  if (kept.prompt !== want.prompt || kept.web !== want.web || kept.listed.dispatch !== want.listed.dispatch) return false;
  if (kept.listed.tools.length !== want.listed.tools.length) return false;
  const names = new Set(kept.listed.tools.map((tool) => tool.name));
  return want.listed.tools.every((tool) => names.has(tool.name));
};

const failed = (cause: { readonly message: string }) =>
  new AgentFault({ code: FAULT.internal, message: `Muse Code's saved host configuration is unreadable: ${cause.message}` });

export const makeConfiguration = Effect.fnUntraced(function* (place: MusePlace) {
  const files = yield* FileSystem.FileSystem;
  const states = new Map<string, Configuration>();
  return {
    select: Effect.fn('muse.configuration.select')(function* (session: string, want: Configuration) {
      let kept = states.get(session);
      if (kept === undefined) {
        const text = yield* keptState(place, session, 'host').pipe(Effect.provideService(FileSystem.FileSystem, files));
        if (text !== null)
          kept = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Configuration))(text).pipe(Effect.mapError(failed));
      }
      if (kept !== undefined && sameSelection(kept, want)) {
        states.set(session, kept);
        return kept;
      }
      yield* keepState(place, session, 'host', JSON.stringify(want)).pipe(Effect.provideService(FileSystem.FileSystem, files));
      states.set(session, want);
      return want;
    }),
  };
});
