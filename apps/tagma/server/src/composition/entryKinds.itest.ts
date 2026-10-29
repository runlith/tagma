import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { bundle } from '@runlith/bundle/bundle';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { foldRolloutHistory } from '../native-harness/transcript/restedWork.js';

it.live(
  'the production bundle emits the composed reader’s fold worker beside its host, and that worker folds with the composed reader',
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'entry-kinds-')))),
        (made) => Effect.sync(() => rmSync(made, { recursive: true, force: true })),
      );
      const outputs = yield* bundle(join(import.meta.dir, 'entryKinds.ts'), 'host.js');
      expect(outputs.map((one) => one.name)).toContain('rested.worker.ts');
      for (const one of outputs) writeFileSync(join(root, one.name), one.text);
      const host: { readonly entryKinds: () => ThreadEntryReader } = yield* Effect.promise(
        () => import(pathToFileURL(join(root, 'host.js')).href),
      );
      const path = join(root, 'told.jsonl');
      const event = {
        position: 1,
        id: 'told',
        kind: 'message',
        payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'law' }] }] },
      };
      writeFileSync(path, `${JSON.stringify({ thread: { id: 'told' } })}\n${JSON.stringify({ kind: 'event', row: event })}\n`);
      const folded = yield* foldRolloutHistory(host.entryKinds(), { path, packed: `${path}.zst`, transcript: `${path}.entries` });
      expect(folded.history).toEqual([{ role: 'user', content: [{ type: 'text', text: 'law' }] }]);
    }),
);
