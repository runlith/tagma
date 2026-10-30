import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Context, Effect, FileSystem } from 'effect';
import { claudeCodeDescription } from '@runlith/adapter-anthropic/models/anthropic';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { sessionOfThread } from '../../../external-harnesses/testing/sessions.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { HarnessDirectories } from '../../../providers/accounts/harnessRows.js';
import { threadEntry, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';
import { windowChannel } from './windowChannel.js';

const PROVIDER = claudeCodeDescription.id;
const FIRST = 'fixture-account';
const SECOND = 'second-account';

describe('a moved default account reaches the Claude threads that follow it', () => {
  layer(protocolWorld({ name: 'hosted-default', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('protocol world', (it) => {
    it.effect('a branch follows default moves and limit recovery, an explicit pin stays, and an operator stop needs Continue', () =>
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
                (line.params as { readonly sessionId?: string } | undefined)?.sessionId === 'sess-fork',
            ).length,
        );

        const kernel = Context.get(world.runtime.owners, ThreadHarness);
        const branched = Effect.fnUntraced(function* (source: string) {
          const answer = yield* world.op('branch_thread', { threadId: source }, `project=${projectId}`);
          expect(answer.status).toBe(200);
          const threadId = String((answer.body as { readonly threadId: string }).threadId);
          yield* Effect.addFinalizer(() => {
            const child = kernel.threads.handle(threadId, 'operator');
            return Effect.andThen(child.stop(), child.release()).pipe(Effect.orDie);
          });
          return threadId;
        });
        const pinned = yield* birth();
        yield* said(pinned, 'source');
        const follower = yield* branched(pinned);
        const delayed = yield* branched(pinned);
        expect((yield* kernel.reads.snapshot(follower)).thread.account).toBeNull();
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
        yield* said(delayed, 'delayed branch');
        expect((yield* kernel.reads.snapshot(delayed)).thread.account).toBeNull();
        expect(yield* process(delayed)).toMatchObject({ state: 'running', account: { key: SECOND } });
        const frames = yield* heard(report);
        const prompted = frames.findIndex(
          (line) => line.method === 'session/prompt' && JSON.stringify(line.params).includes('delayed branch'),
        );
        expect(frames.slice(0, prompted).findLast((line) => line.method === '_tagma/fork' || line.method === 'session/new')?.method).toBe(
          'session/new',
        );

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

        const operatorRun = yield* said(follower, 'HOLD the next turn', 'running');
        const window = yield* windowChannel(world);
        expect(yield* window['thread.stop']({ projectId, threadId: follower, params: { runId: operatorRun.id } })).toMatchObject({
          status: 'stopped',
          runId: operatorRun.id,
        });
        const stoppedRuns = new Set((yield* runsOf(follower)).map((run) => run.id));
        yield* moveDefault(FIRST);
        yield* until(
          Effect.map(process(follower), (session) => (session?.state === 'ended' ? session : null)),
          'the stopped follower released its old account without opening a turn',
          report,
        );
        const admission = Context.get(world.runtime.owners, RunAdmission);
        yield* Effect.callback<void>((resume) => {
          const unlisten = admission.onLift((threadId) => {
            if (threadId === follower) resume(Effect.void);
          });
          if (!admission.wakeOnLift(follower)) resume(Effect.void);
          return Effect.sync(unlisten);
        });
        expect((yield* kernel.reads.snapshot(follower)).latestRun?.id).toBe(operatorRun.id);
        yield* window['thread.continue']({ projectId, threadId: follower });
        yield* ended(follower, 'completed', stoppedRuns);
        expect(yield* process(follower)).toMatchObject({ state: 'running', account: { key: FIRST } });
      }),
    );
  });
});
