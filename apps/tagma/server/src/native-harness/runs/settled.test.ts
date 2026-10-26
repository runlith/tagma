import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { grantBookOver, interactiveGrant, threadActor } from '../../executions/testing/doubles.js';
import { TerminalRefused } from '../../executions/contract/wire/refusals.js';
import type { InteractiveGrant } from '../../executions/contract/wire/terminals.js';
import { TerminalGrants } from '../../executions/contract/service/grants.js';
import { Worlds } from '../../executions/contract/service/worlds.js';
import { WebCache } from '@runlith/llm/profiles/webCache';
import { WorkspaceInputs } from '../contract/service/inputs.js';
import { runWebs } from '../turns/runWebs.js';
import { commandDescriptions } from '../turns/commandDescriptions.js';
import { makeSettledRelease } from './settled.js';

describe('the release of a settled run', () => {
  const actor = threadActor;
  const grant = (threadId: string, execution: string, binding: string, runId?: string): InteractiveGrant =>
    interactiveGrant({ threadId, execution, binding, runId });
  const claimOf = (live: InteractiveGrant) => ({
    projectId: live.projectId,
    execution: live.execution,
    actor: live.actor,
    binding: live.binding,
    targetKey: live.targetKey,
    permissionRevision: live.permissionRevision,
    runId: live.runId,
  });

  const releasesOver = () => {
    const released: [string, string][] = [];
    const release = (owner: string) => (threadId: string, runId: string) =>
      Effect.sync(() => {
        released.push([`${owner}:${threadId}`, runId]);
      });
    return {
      released,
      sourceCache: { releaseRun: release('sources') },
      worlds: { releaseRun: release('worlds') },
    };
  };

  const releaseOver = (
    grants: ReturnType<typeof grantBookOver>,
    caches: ReturnType<typeof releasesOver>,
    descriptions = commandDescriptions(),
  ) =>
    makeSettledRelease({ webs: runWebs(new WebCache(1)), descriptions }).pipe(
      Effect.provideService(TerminalGrants, grants as unknown as TerminalGrants['Service']),
      Effect.provideService(WorkspaceInputs, caches.sourceCache as unknown as WorkspaceInputs['Service']),
      Effect.provideService(Worlds, caches.worlds as unknown as Worlds['Service']),
    );

  it.effect('a settled run ends its own keyed grants and the run-less ones, and releases what the run held', () =>
    Effect.gen(function* () {
      const verbs: string[] = [];
      const grants = grantBookOver('acknowledges', verbs);
      const mine = grant('thread-1', 'exec-1', 'binding-1', 'run-1');
      const keyless = grant('thread-1', 'exec-2', 'binding-2');
      const theirs = grant('thread-2', 'exec-3', 'binding-3', 'run-9');
      yield* Effect.all([grants.mint(mine, 'agent'), grants.mint(keyless, 'agent'), grants.mint(theirs, 'agent')], { discard: true });
      const caches = releasesOver();
      const descriptions = commandDescriptions();
      const use = { kind: 'tools', runId: 'run-1', context: null } as const;
      yield* descriptions.of(use, Effect.succeed('required'));

      yield* (yield* releaseOver(grants, caches, descriptions))({ threadId: 'thread-1', runId: 'run-1' });
      expect(yield* descriptions.of(use, Effect.succeed('optional'))).toBe('optional');

      expect(grants.of(actor('thread-1'))).toEqual([]);
      for (const gone of [mine, keyless]) {
        expect(yield* Effect.flip(grants.evidence(claimOf(gone)))).toBeInstanceOf(TerminalRefused);
      }
      expect(grants.of(actor('thread-2'))).toHaveLength(1);
      expect(verbs).toEqual(['closeBinding', 'closeBinding']);
      expect(caches.released).toEqual([
        ['sources:thread-1', 'run-1'],
        ['worlds:thread-1', 'run-1'],
      ]);
    }),
  );

  it.effect("a settled run never ends another live run's grants", () =>
    Effect.gen(function* () {
      const verbs: string[] = [];
      const grants = grantBookOver('acknowledges', verbs);
      const caches = releasesOver();
      const past = grant('thread-1', 'exec-1', 'binding-1', 'run-1');
      const live = grant('thread-1', 'exec-2', 'binding-2', 'run-2');
      yield* Effect.all([grants.mint(past, 'agent'), grants.mint(live, 'agent')], { discard: true });

      yield* (yield* releaseOver(grants, caches))({ threadId: 'thread-1', runId: 'run-1' });

      expect(grants.of(actor('thread-1'))).toHaveLength(1);
      expect(yield* Effect.flip(grants.evidence(claimOf(past)))).toBeInstanceOf(TerminalRefused);
      expect(yield* grants.evidence(claimOf(live))).toMatchObject({ binding: live.binding });
      expect(verbs).toEqual(['closeBinding']);
    }),
  );

  it.effect('a later run of the same thread acquires anew', () =>
    Effect.gen(function* () {
      const verbs: string[] = [];
      const grants = grantBookOver('acknowledges', verbs);
      const release = yield* releaseOver(grants, releasesOver());

      yield* grants.mint(grant('thread-1', 'exec-1', 'binding-1', 'run-1'), 'agent');
      yield* release({ threadId: 'thread-1', runId: 'run-1' });
      const again = grant('thread-1', 'exec-1', 'binding-2', 'run-2');
      yield* grants.mint(again, 'agent');

      expect(grants.of(actor('thread-1'))).toHaveLength(1);
      expect(yield* grants.evidence(claimOf(again))).toMatchObject({ binding: again.binding });
    }),
  );

  it.effect('a fence the host does not acknowledge stays pending and refuses input, and the process is untouched', () =>
    Effect.gen(function* () {
      const verbs: string[] = [];
      const grants = grantBookOver('unreachable', verbs);
      const mine = grant('thread-1', 'exec-1', 'binding-1');
      yield* grants.mint(mine, 'agent');

      yield* (yield* releaseOver(grants, releasesOver()))({ threadId: 'thread-1', runId: 'run-1' });

      expect(grants.of(actor('thread-1'))).toEqual([]);
      expect(grants.revoking(claimOf(mine))).toBe('run-ended');
      expect(yield* Effect.flip(grants.evidence(claimOf(mine)))).toMatchObject({ _tag: 'TerminalRefused', reason: 'stale' });
      expect(verbs).toEqual(['closeBinding']);
    }),
  );
});
