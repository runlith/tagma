import { Effect, Result, Schema } from 'effect';
import { AgentFault, FAULT, type AgentHandlers, type Outlet } from '@runlith/acp/agent';
import { ContentBlock } from '@runlith/acp/content';
import type { NewSessionResult } from '@runlith/acp/methods';
import { ASIDE, Aside, COMPACT, FORK, REWIND, STEER, WITHDRAW } from '../../contract/wire/extensions.js';
import type { Cycle, Opening, Session } from './cycle.js';
import type { HostedDoor } from './door.js';
import { Turn } from './turn.js';

const Steer = Schema.Struct({ sessionId: Schema.String, prompt: Schema.Array(ContentBlock), input: Schema.optional(Schema.String) });
const Withdraw = Schema.Struct({ sessionId: Schema.String, input: Schema.String });
const Compact = Schema.Struct({
  sessionId: Schema.String,
  instructions: Schema.optional(Schema.String),
  at: Schema.optional(Schema.Literals(['step', 'end'])),
});
const Fork = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.optional(Schema.String),
  turn: Schema.optional(Schema.NullOr(Schema.String)),
});
const Rewind = Schema.Struct({ sessionId: Schema.String, turn: Schema.String });

const decoded = <A>(schema: Schema.Codec<A, unknown>, method: string) => {
  const decode = Schema.decodeUnknownResult(schema);
  return (params: unknown): Effect.Effect<A, AgentFault> => {
    const read = decode(params ?? {});
    return Result.isFailure(read)
      ? Effect.fail(new AgentFault({ code: FAULT.invalidParams, message: `${method} params: ${String(read.failure)}` }))
      : Effect.succeed(read.success);
  };
};

const turnOf = (meta: unknown): unknown =>
  typeof meta === 'object' && meta !== null && 'tagma/turn' in meta ? meta['tagma/turn'] : undefined;

export const hostedAgent =
  (cycle: Cycle, door: HostedDoor) =>
  (outlet: Outlet): AgentHandlers<never> => {
    let session: Session | null = null;
    let turn: Turn | null = null;
    const live = (id: string): Effect.Effect<Session, AgentFault> =>
      session !== null && session.id === id
        ? Effect.succeed(session)
        : Effect.fail(new AgentFault({ code: FAULT.notFound, message: `this process holds no open session ${id}` }));
    const setup = (standing: Session): NewSessionResult => {
      session = standing;
      turn = new Turn(door, standing);
      return { sessionId: standing.id, modes: cycle.modes, configOptions: [...standing.configOptions()] };
    };
    const replacing = Effect.gen(function* () {
      if (turn?.busy() === true)
        return yield* new AgentFault({ code: FAULT.invalidRequest, message: `session ${session!.id} is running a turn; cancel it first` });
      if (session !== null) yield* session.close();
      session = null;
      turn = null;
    });
    const replace = (open: Effect.Effect<Session, AgentFault>) => Effect.map(open, setup);
    const opening = (
      id: string,
      cwd: string,
      mcpServers: Opening['mcpServers'],
      directories: readonly string[] | undefined,
      origin: Opening['origin'],
      history: Opening['history'],
    ): Opening => ({ id, cwd, mcpServers, additionalDirectories: directories ?? [], origin, history, held: session?.id });
    const resume = (id: string, cwd: string, servers: Opening['mcpServers'], directories: readonly string[] | undefined) =>
      Effect.map(
        replace(cycle.open(opening(id, cwd, servers, directories, 'resume', []), outlet, replacing)),
        ({ sessionId: _, ...rest }) => rest,
      );
    const absent = (method: string) =>
      Effect.fail(new AgentFault({ code: FAULT.methodNotFound, message: `this agent does not implement ${method}` }));
    const fork = (id: string, cwd: string, at: string | null) =>
      cycle.fork === undefined ? absent(FORK) : replace(cycle.fork(id, cwd, at, outlet, replacing));
    const declared = cycle.extensions;
    const extensions: Record<string, (params: unknown) => Effect.Effect<unknown, AgentFault>> = {};
    {
      if (declared.includes(STEER))
        extensions[STEER] = (params) =>
          Effect.flatMap(decoded(Steer, STEER)(params), (asked) =>
            Effect.flatMap(live(asked.sessionId), () => turn!.steer(asked.prompt, asked.input)),
          );
      if (declared.includes(WITHDRAW))
        extensions[WITHDRAW] = (params) =>
          Effect.flatMap(decoded(Withdraw, WITHDRAW)(params), (asked) =>
            Effect.flatMap(live(asked.sessionId), () => turn!.withdraw(asked.input)),
          );
      if (declared.includes(COMPACT))
        extensions[COMPACT] = (params) =>
          Effect.flatMap(decoded(Compact, COMPACT)(params), (asked) =>
            Effect.flatMap(
              live(asked.sessionId),
              (standing) => standing.compact?.(asked.instructions ?? '', asked.at ?? 'end') ?? absent(COMPACT),
            ),
          );
      if (declared.includes(ASIDE))
        extensions[ASIDE] = (params) =>
          Effect.flatMap(decoded(Aside, ASIDE)(params), (asked) =>
            Effect.flatMap(live(asked.sessionId), (standing) => standing.aside?.(asked.question) ?? absent(ASIDE)),
          );
      if (declared.includes(FORK))
        extensions[FORK] = (params) =>
          Effect.flatMap(decoded(Fork, FORK)(params), (asked) => {
            const cwd = asked.cwd ?? session?.cwd;
            return cwd === undefined
              ? Effect.fail(
                  new AgentFault({ code: FAULT.invalidParams, message: `${FORK} names the cwd of a session this process has not opened` }),
                )
              : fork(asked.sessionId, cwd, asked.turn ?? null);
          });
      if (declared.includes(REWIND))
        extensions[REWIND] = (params) =>
          Effect.flatMap(decoded(Rewind, REWIND)(params), (asked) =>
            Effect.flatMap(live(asked.sessionId), (standing) => fork(standing.id, standing.cwd, asked.turn)),
          );
    }
    return {
      initialize: () =>
        Effect.succeed({
          ...cycle.initialize,
          agentCapabilities: { ...cycle.initialize.agentCapabilities, _meta: { 'tagma/extensions': [...cycle.extensions] } },
        }),
      newSession: Effect.fnUntraced(function* (params) {
        const history = yield* door.history();
        return yield* replace(
          cycle.open(
            opening(crypto.randomUUID(), params.cwd, params.mcpServers, params.additionalDirectories, 'new', history),
            outlet,
            replacing,
          ),
        );
      }),
      loadSession: (params) => resume(params.sessionId, params.cwd, params.mcpServers, params.additionalDirectories),
      resumeSession: (params) => resume(params.sessionId, params.cwd, params.mcpServers ?? [], params.additionalDirectories),
      prompt: (params) => Effect.flatMap(live(params.sessionId), () => turn!.prompt(params.prompt, turnOf(params._meta))),
      cancel: (params) => (session?.id === params.sessionId && turn !== null ? turn.cancel() : Effect.void),
      configure: Effect.fnUntraced(function* (params) {
        const standing = yield* live(params.sessionId);
        if (!('value' in params) || typeof params.value !== 'string')
          return yield* new AgentFault({ code: FAULT.invalidParams, message: `${params.configId} takes a value from its options` });
        return { configOptions: [...(yield* standing.configure(params.configId, params.value))] };
      }),
      setMode: (params) =>
        Effect.flatMap(live(params.sessionId), () =>
          params.modeId === cycle.modes.currentModeId
            ? Effect.succeed({})
            : Effect.fail(new AgentFault({ code: FAULT.invalidParams, message: `this agent runs only in ${cycle.modes.currentModeId}` })),
        ),
      close: Effect.fnUntraced(function* (params) {
        const standing = yield* live(params.sessionId);
        if (turn !== null) yield* turn.close();
        yield* standing.close();
        session = null;
        turn = null;
        return {};
      }),
      extensions,
      ended: Effect.suspend(() => Effect.andThen(turn?.close() ?? Effect.void, session?.close() ?? Effect.void)),
    };
  };
