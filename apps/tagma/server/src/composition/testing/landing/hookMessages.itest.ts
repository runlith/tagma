import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { landingAdmission } from '../../preparedChanges.js';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { commitEffect, composed, shEffect } from '../finishingFixture.js';
import { PLACE } from '../checkoutFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { UNCHECKED } from '../../../enforcement/contract/wire/checks.js';
import { submitOver, underCheckoutLanes } from '../../../landing/testing/doubles.js';
import { landingServices } from '../landingServices.js';
import { testPlace } from '../../../workspace/testing/doubles.js';
import type { WorkingOrigin } from '../../../workspace/contract/wire/place.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import {
  claimPreparedInstance,
  eligiblePaths,
  evidenceInGroups,
  judgingFns,
  makePreparedChanges,
  quietCommands,
  pathChunks,
  pathsOfThread,
  preparedBase,
  recordWrite,
} from '../../../change-record/testing/doubles.js';
layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('concurrent hook messages', (it) => {
  it.effect(
    'a concurrent landing and worktree merge commit their own hook-modified messages',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { finishing, make, project, projectId } = yield* composed(
            demo,
            makeMachineWorld(() => null),
          );
          const side = yield* make('side');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          const origin = { ...PLACE, generation: 0, work: { projectId, threadId: 'writer' } } as WorkingOrigin;
          writeFileSync(join(project, 'mine.txt'), 'mine\n');
          yield* recordWrite(demo.graph.units, demo.graph.store, projectId, 'writer', testPlace('mine.txt'), {
            before: '',
            after: 'mine\n',
            mode: '100644',
          });
          const hook = join(project, '.git', 'hooks', 'prepare-commit-msg');
          writeFileSync(
            hook,
            [
              '#!/bin/sh',
              'if grep -q Tagma-Worktree "$1"; then printf "\\nmerge-hook\\n" >> "$1"; else printf "\\nlanding-hook\\n" >> "$1"; fi',
              '',
            ].join('\n'),
            { mode: 0o755 },
          );
          const inst = yield* Effect.acquireRelease(claimPreparedInstance(preparedBase(demo.graph.store)), (instance) => instance.release);
          const producer = makePreparedChanges(
            { commands: quietCommands, pathsOfThread, evidenceInGroups },
            landingAdmission(makeLandingHolds()),
            judgingFns(CHECKOUT_DIRECTORY),
            inst.dir,
          );
          const services = yield* landingServices;
          const landing = submitOver(
            demo.graph.git,
            project,
            demo.graph.store,
            demo.graph.units,
            origin,
            { projectId, subject: 'the writer lands mine', tasks: [], taking: [] },
            { before: () => Effect.succeed(UNCHECKED), after: () => Effect.void },
            producer,
          ).pipe(Effect.provide(services));
          const merging = finishing.merge(projectId, side.rootId, {});
          const [receipt, merged] = yield* underCheckoutLanes(Effect.all([landing, merging], { concurrency: 2 }));
          if (receipt.status !== 'landed') return yield* Effect.die(new Error(`expected a landing, got ${JSON.stringify(receipt)}`));
          const landed = yield* shEffect(project, ['log', '-1', '--format=%B', receipt.commit]);
          const merge = yield* shEffect(project, ['log', '-1', '--format=%B', merged.base.head]);
          expect(landed).toStartWith('the writer lands mine');
          expect(landed).not.toContain('Tagma-Worktree');
          expect(landed).toContain('landing-hook');
          expect(landed).not.toContain('merge-hook');
          expect(merge).toContain('merge-hook');
          expect(merge).not.toContain('landing-hook');
          expect(merge).toContain(`Tagma-Worktree: ${side.rootId}`);
          expect(merge).not.toContain('the writer lands mine');
        }),
      ),
    30000,
  );
});
