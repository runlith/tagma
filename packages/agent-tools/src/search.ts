import { Effect, type PlatformError, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { ToolFailed } from '@runlith/agent/tool';
import type { SearchFailure, SearchRun } from '@runlith/ripgrep/run';
import type { World } from './world';
import { refused } from './refusals';

export const searchRun = (world: World, cwd: string, ceilingMs: number): Effect.Effect<SearchRun, ToolFailed> =>
  Effect.map(world.environment.executables.ripgrep, (binary) => ({ binary, cwd, platform: world.environment.platform, ceilingMs }));

const surfaced = <A>(
  events: Stream.Stream<A, SearchFailure, ChildProcessSpawner.ChildProcessSpawner>,
): Stream.Stream<A, PlatformError.PlatformError | ToolFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  events.pipe(
    Stream.mapError((failure) =>
      failure._tag === 'PlatformError'
        ? failure
        : failure._tag === 'SearchFailed' && failure.badPattern
          ? refused('bad-pattern', failure.message)
          : new ToolFailed({ reason: failure.message }),
    ),
  );

export const collected = <A>(
  events: Stream.Stream<A, SearchFailure, ChildProcessSpawner.ChildProcessSpawner>,
): Effect.Effect<readonly A[], PlatformError.PlatformError | ToolFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  Stream.runCollect(surfaced(events));

export const folded = <A, S>(
  events: Stream.Stream<A, SearchFailure, ChildProcessSpawner.ChildProcessSpawner>,
  initial: () => S,
  step: (state: S, event: A) => S,
): Effect.Effect<S, PlatformError.PlatformError | ToolFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  Stream.runFold(surfaced(events), initial, step);
