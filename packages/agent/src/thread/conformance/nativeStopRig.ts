import { Effect } from 'effect';
import { ThreadCallBroke } from '../ThreadBorder';
import { compactionWorld, hold, opened, OWNER, quiet, SCOPE, started, until, type CompactionWorld, type Hold } from './compactionWorld';
import { seeded } from './compactionRequests/support';
import type { ThreadStorageFactory, ThreadStorageHarness } from './storagePort';
import type { StopCase, StopRig, StopState, Unreachable } from './transportStops';

const unreached = (unreachable: string): Unreachable => ({ unreachable });

const UNREACHABLE: Partial<Record<StopState, string>> = {
  'vendor-call': 'a native run calls no vendor tools',
  reopening: 'a native thread holds no vendor session to reopen',
  unlinked: 'a native run has no agent process to lose its link to',
  repeated: 'the native loop ends with the first stop, and no agent outlives it to be told again',
};

const stopCase = <TTx, TWrite extends TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  world: CompactionWorld<TTx, TWrite>,
  threadId: string,
  runId: string,
  holds: readonly Hold[],
  stop = world.harness.threads.handle(threadId, OWNER).stop(),
): StopCase => {
  const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
  return {
    runId,
    stop: () => stop,
    ended: () =>
      Effect.map(runs.runById(runId), (run) =>
        run === null || run.status === 'running'
          ? null
          : { status: run.status, stoppedBy: run.settledBy, finishedAt: run.finishedAt ?? run.updatedAt },
      ),
    journal: () =>
      Effect.map(Effect.zip(storage.aggregate.entriesOfRun(threadId, runId), runs.runById(runId)), ([entries, run]) => ({
        entries,
        tail: run?.streamTail ?? null,
      })),
    agentTurns: () => Effect.map(runs.runsOf(threadId), (all) => all.length),
    interrupts: () => Effect.succeed(0),
    runsAfter: () =>
      Effect.map(
        runs.runsOf(threadId),
        (all) => all.slice(all.findIndex((run) => run.id === runId) + 1).filter((run) => run.origin === 'core').length,
      ),
    settle: () =>
      Effect.andThen(
        Effect.sync(() => {
          for (const held of holds) held.release();
        }),
        quiet(world, threadId),
      ),
  };
};

const tailed = <TTx, TWrite extends TTx>(storage: ThreadStorageHarness<TTx, TWrite>, runId: string) =>
  until(() => Effect.map(storage.runs({ ownerId: 'observer', scope: SCOPE }).runById(runId), (run) => (run?.streamTail?.length ?? 0) > 0));

export const nativeStopRig = <TTx, TWrite extends TTx = TTx, R = never>(open: ThreadStorageFactory<TTx, TWrite, R>): StopRig<R> => ({
  reach: Effect.fnUntraced(function* (state: StopState) {
    const unreachable = UNREACHABLE[state];
    if (unreachable !== undefined) return unreached(unreachable);
    const stack = yield* opened(open);
    const { storage, world, threadId, handle } = stack;
    const parked = hold();
    switch (state) {
      case 'opening': {
        world.answers.push({ parks: parked });
        return stopCase(storage, world, threadId, yield* started(handle, 'Begin.'), [parked]);
      }
      case 'thinking':
      case 'writing': {
        world.answers.push({ parks: parked, opens: state === 'thinking' ? 'reasoning' : 'text' });
        const runId = yield* started(handle, 'Begin.');
        yield* parked.reached;
        yield* tailed(storage, runId);
        return stopCase(storage, world, threadId, runId, [parked]);
      }
      case 'tagma-call': {
        world.tool = parked;
        world.answers.push({ tool: 'work' });
        const runId = yield* started(handle, 'Do the work.');
        yield* parked.reached;
        return stopCase(storage, world, threadId, runId, [parked]);
      }
      case 'question': {
        yield* handle.setAuthorityMode('review');
        world.answers.push({ call: 'push', input: {} });
        const runId = yield* started(handle, 'Publish the work.');
        yield* until(() => Effect.map(world.harness.reads.snapshot(threadId), (state) => state.status.openQuestions.length > 0));
        return stopCase(storage, world, threadId, runId, []);
      }
      case 'compaction-step': {
        yield* seeded(stack);
        const stall = hold();
        world.tool = parked;
        world.summaries.push({ stalls: stall });
        world.answers.push({ tool: 'work' });
        const runId = yield* started(handle, 'Do the work.');
        yield* parked.reached;
        yield* handle.compact({ at: 'step' });
        parked.release();
        yield* stall.reached;
        return stopCase(storage, world, threadId, runId, [stall]);
      }
      case 'compaction-end': {
        yield* seeded(stack);
        const stall = hold();
        world.summaries.push({ stalls: stall });
        const compacting = yield* handle.compact({ at: 'end' });
        if (compacting.status !== 'started')
          return yield* new ThreadCallBroke({ cause: new Error(`the compaction answered ${compacting.status} instead of starting a run`) });
        yield* stall.reached;
        return stopCase(storage, world, threadId, compacting.runId, [stall]);
      }
      case 'steer-unechoed': {
        world.answers.push({ parks: parked, opens: 'text' }, { text: 'Took the other table.' });
        const runId = yield* started(handle, 'Begin.');
        yield* parked.reached;
        const steered = yield* handle.send('Use the other table.');
        if (steered.status !== 'steered')
          return yield* new ThreadCallBroke({ cause: new Error(`the words answered ${steered.status} instead of going into the run`) });
        return stopCase(storage, world, threadId, runId, [parked]);
      }
      case 'steer-echoed': {
        const next = hold();
        world.tool = parked;
        world.answers.push({ tool: 'work' }, { parks: next });
        const runId = yield* started(handle, 'Do the work.');
        yield* parked.reached;
        yield* handle.send('Use the other table.');
        parked.release();
        yield* next.reached;
        return stopCase(storage, world, threadId, runId, [next]);
      }
      case 'natural-end': {
        const answering = hold();
        world.answers.push({ text: 'Done.', held: answering });
        const runId = yield* started(handle, 'Begin.');
        yield* answering.reached;
        return stopCase(
          storage,
          world,
          threadId,
          runId,
          [],
          Effect.andThen(
            Effect.sync(() => answering.release()),
            handle.stop(),
          ),
        );
      }
      case 'restarted': {
        world.answers.push({ parks: parked });
        const runId = yield* started(handle, 'Begin.');
        yield* parked.reached;
        yield* world.dispose();
        const later = yield* compactionWorld(storage, stack.agentId);
        return stopCase(storage, later, threadId, runId, [parked]);
      }
      default:
        return yield* Effect.die(new Error(`the native rig has no way into ${state}`));
    }
  }),
});
