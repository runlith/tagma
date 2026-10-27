import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { Clock, Context, Effect, FileSystem } from 'effect';
import { claudeCodeDescription } from '@runlith/adapter-anthropic/models/anthropic';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { sessionOfThread } from '../../../external-harnesses/testing/sessions.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { HarnessDirectories } from '../../../providers/accounts/harnessRows.js';
import { threadEntry, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, LIBRARY, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const PROVIDER = claudeCodeDescription.id;
const FIRST = 'fixture-account';
const SECOND = 'second-account';

describe.skipIf(!existsSync(LIBRARY))('a moved default account reaches the Claude threads that follow it', () => {
  layer(protocolWorld({ name: 'hosted-default', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('protocol world', (it) => {
    it.effect(
      'a follower moves at rest, a turn refused by the limit continues, a running turn moves at its step, and a pinned thread stays',
      () =>
        Effect.gen(function* () {
          const { world, projectId, agent, birth } = yield* ProtocolWorld;
          const files = yield* FileSystem.FileSystem;
          const directories = Context.get(world.runtime.owners, HarnessDirectories);
          const second = yield* world.directory('claude-second');
          yield* Effect.acquireRelease(
            Effect.flatMap(Clock.currentTimeMillis, (addedAt) =>
              directories.keep(PROVIDER, {
                key: AccountKey.make(SECOND),
                label: 'second@example.com',
                machine: directories.machine,
                directory: second,
                addedAt,
                signed: true,
                pending: false,
              }),
            ),
            () => directories.remove(PROVIDER, AccountKey.make(SECOND)).pipe(Effect.orDie),
          );
          const report = yield* agent('default-move');
          const db = Context.get(world.runtime.graph, MachineStore).db;
          const units = Context.get(world.runtime.graph, MachineUnits);
          const turns = turnsOf(world.runtime.owners);
          const runsOf = (threadId: string) =>
            units.read((unit) => unit.run(db.select().from(threadRun()).where(eq(threadRun().threadId, threadId)).all()));
          const ended = (threadId: string, status: string, after: ReadonlySet<string> = new Set()) =>
            until(
              Effect.map(runsOf(threadId), (runs) => runs.find((run) => !after.has(run.id) && run.status === status) ?? null),
              `a ${status} run of ${threadId}`,
              report,
            );
          const said = Effect.fnUntraced(function* (threadId: string, text: string, status = 'completed') {
            const known = new Set((yield* runsOf(threadId)).map((run) => run.id));
            yield* turns.send(threadId, projectId, text);
            return yield* ended(threadId, status, known);
          });
          const process = (threadId: string) => Effect.map(sessionOfThread(db, threadId), (facet) => facet?.session ?? null);
          const moveDefault = Effect.fnUntraced(function* (account: string | null) {
            expect((yield* world.op('set_default_account', { provider: PROVIDER, account })).status).toBe(200);
          });
          const reopened = Effect.map(
            heard(report),
            (lines) =>
              lines.filter(
                (line) =>
                  (line.method === 'session/resume' || line.method === 'session/load') &&
                  (line.params as { readonly sessionId?: string } | undefined)?.sessionId === 'sess-1',
              ).length,
          );

          const follower = yield* birth();
          const pinned = yield* birth();
          expect(
            (yield* world.op(
              'set_thread_model',
              { threadId: pinned, provider: PROVIDER, model: 'claude-opus-5-5', reasoning: null, switches: {}, account: FIRST },
              `project=${projectId}`,
            )).status,
          ).toBe(200);
          yield* said(follower, 'first');
          yield* said(pinned, 'pinned');
          expect(yield* process(follower)).toMatchObject({ state: 'running', account: { key: FIRST } });

          yield* moveDefault(SECOND);
          yield* until(
            Effect.map(process(follower), (session) => (session?.state === 'ended' ? session : null)),
            'the follower process released at rest',
            report,
          );
          const before = yield* reopened;
          yield* said(follower, 'second');
          expect(yield* process(follower)).toMatchObject({ state: 'running', account: { key: SECOND } });
          expect(yield* reopened).toBe(before + 1);
          expect(yield* process(pinned)).toMatchObject({ state: 'running', account: { key: FIRST } });

          yield* files.writeFileString(`${report}.limited`, second);
          const refused = yield* said(follower, 'RATELIMIT', 'failed');
          expect(refused.failure?.reason?.family).toBe('rate-limit');
          const limited = new Set((yield* runsOf(follower)).map((run) => run.id));
          yield* moveDefault(null);
          yield* moveDefault(FIRST);
          yield* ended(follower, 'completed', limited);
          expect(yield* process(follower)).toMatchObject({ state: 'running', account: { key: FIRST } });
          expect((yield* runsOf(follower)).filter((run) => !limited.has(run.id))).toHaveLength(1);

          const { id: held } = yield* said(follower, 'HOLD the turn', 'running');
          const known = new Set((yield* runsOf(follower)).map((run) => run.id));
          yield* moveDefault(SECOND);
          const stopped = yield* until(
            Effect.flatMap(files.writeFileString(`${report}.refused`, ''), () =>
              Effect.map(runsOf(follower), (runs) => runs.find((run) => run.id === held && run.status !== 'running') ?? null),
            ),
            'the held turn stopped at a step',
            report,
          );
          expect(stopped).toMatchObject({ status: 'aborted', settledBy: 'model' });
          yield* files.remove(`${report}.refused`, { force: true });
          yield* ended(follower, 'completed', known);
          expect(yield* process(follower)).toMatchObject({ state: 'running', account: { key: SECOND } });
          const interruptions = (yield* units.read((unit) =>
            unit.run(db.select().from(threadEntry()).where(eq(threadEntry().threadId, follower)).all()),
          )).filter(({ entry }) => coreEntry(entry) && entry.type === 'interruption');
          expect(interruptions).toEqual([]);
          expect(yield* process(pinned)).toMatchObject({ state: 'running', account: { key: FIRST } });
        }),
    );
  });
});
