import { Console, Effect, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import { type SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { HISTORY_OPERATIONS } from '../contract/wire/operations/history.js';
import { OUTLINE_OPERATIONS } from '../contract/wire/operations/outline.js';

export type ListingsCli = {
  readonly perform: Perform;
  readonly lens: (at: Invocation, options: { project?: string | undefined }) => DoorLens;
  readonly sessionIdentity: () => Effect.Effect<SessionIdentity['Service'], unknown>;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(Flag.optional, Flag.withMetavar('name|id'));
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

export const listings = ({ perform, lens, sessionIdentity }: ListingsCli) => {
  const edges = Command.make('edges', { json, project }, (input) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      const { edges: rows } = yield* perform(OUTLINE_OPERATIONS.read_edges, {}, lens(at, { project: optional(input.project) }));
      if (input.json) return yield* print(rows, true);
      yield* Console.log(rows.map((row) => `${row.fromName} -${row.kind}-> ${row.toName}`).join('\n'));
    }),
  ).pipe(Command.withDescription('every typed edge of the project'));

  const sessions = Command.make(
    'sessions',
    { json, project, limit: Flag.Int('limit').pipe(Flag.optional), cursor: Flag.String('cursor').pipe(Flag.optional) },
    (input) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const page = yield* perform(
          HISTORY_OPERATIONS.list_sessions,
          { limit: optional(input.limit) ?? 20, cursor: optional(input.cursor) },
          lens(at, { project: optional(input.project) }),
        );
        if (input.json) return yield* print(page, true);
        const identity = yield* sessionIdentity();
        for (const row of page.sessions)
          yield* Console.log(`${row.id} ${sessionName(row, identity)} · ${row.harness}:${row.key} · born ${row.createdAt}`);
        yield* Console.log(`${page.shown} of ${page.total}${page.next === null ? '' : ` · next: sessions --cursor ${page.next}`}`);
      }),
  ).pipe(Command.withDescription('a page of the session registry'));

  return { edges, sessions };
};
