import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { RolloutReads, type RolloutRead } from '../../threads/contract/service/rolloutReads.js';
import { makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { foldRolloutHistory, transcribeRollout } from './restedWork.js';
import { coreKinds, formedKinds } from '../testing/readers.js';

const core = coreKinds();

const scratch = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

it.live('real rollout reads cross the fold worker boundary without sampling', () =>
  Effect.gen(function* () {
    const root = yield* scratch('observed-rollout-');
    const path = join(root, 'observed.jsonl');
    const reads: RolloutRead[] = [];
    writeFileSync(path, '{"thread":{"id":"observed"}}\n');
    const rollout = { path, packed: `${path}.zst`, transcript: `${path}.entries` };
    yield* foldRolloutHistory(core, rollout).pipe(Effect.provideService(RolloutReads, (read) => reads.push(read)));
    expect([...new Set(reads.map((read) => read.path))]).toEqual([path]);
    expect(reads.reduce((sum, read) => sum + read.bytes, 0)).toBe(statSync(path).size);
    reads.length = 0;
    const entries = yield* transcribeRollout(core, rollout, { bytes: statSync(path).size, position: 0 }).pipe(
      Effect.provideService(RolloutReads, (read) => reads.push(read)),
    );
    expect(entries).toBe(0);
    expect(reads.reduce((sum, read) => sum + read.bytes, 0)).toBe(statSync(path).size);
  }),
);

it.live('a rested history folds a message stored before a form step in its current form', () =>
  Effect.gen(function* () {
    const root = yield* scratch('formed-rollout-');
    const path = join(root, 'formed.jsonl');
    const event = { position: 1, id: 'told', kind: 'message', payload: { messages: [{ role: 'user', content: 'law' }] } };
    writeFileSync(path, `${JSON.stringify({ thread: { id: 'formed' } })}\n${JSON.stringify({ kind: 'event', row: event })}\n`);
    const folded = yield* foldRolloutHistory(formedKinds(), { path, packed: `${path}.zst`, transcript: `${path}.entries` });
    expect(folded.history).toEqual([{ role: 'user', content: [{ type: 'text', text: 'law' }] }]);
  }),
);

it.live('a reader whose worker entry is missing fails as a worker failure, and the next read reaches the entry once it stands', () =>
  Effect.gen(function* () {
    const root = yield* scratch('rested-worker-');
    const entry = join(root, 'core.worker.js');
    const missing = makeThreadEntryReader({ products: [], worker: () => new Worker(pathToFileURL(entry).href, { type: 'module' }) });
    const rollout = { path: join(root, 'absent.jsonl'), packed: join(root, 'absent.zst'), transcript: join(root, 'transcript') };
    const failed = yield* Effect.all(
      [Effect.result(foldRolloutHistory(missing, rollout)), Effect.result(transcribeRollout(missing, rollout, { bytes: 0, position: 0 }))],
      { concurrency: 'unbounded' },
    );
    for (const answer of failed) {
      expect(answer._tag === 'Failure' ? answer.failure : answer.success).toMatchObject({
        _tag: 'WorkerUnavailable',
        worker: 'rested fold worker',
      });
    }
    const built = yield* Effect.promise(() =>
      Bun.build({ entrypoints: [join(import.meta.dir, '../testing/core.worker.ts')], target: 'bun' }),
    );
    expect(built.success ? [] : built.logs).toEqual([]);
    writeFileSync(entry, yield* Effect.promise(() => built.outputs[0]!.text()));
    const read = yield* Effect.result(foldRolloutHistory(missing, rollout));
    expect(read._tag === 'Failure' ? read.failure : read.success).toMatchObject({ _tag: 'RolloutUnreadable', path: rollout.path });
  }),
);
