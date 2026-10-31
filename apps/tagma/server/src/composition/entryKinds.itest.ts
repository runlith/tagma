import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { bundle } from '@runlith/bundle/bundle';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { transcribeRollout } from '../native-harness/transcript/restedWork.js';

const law = { projectId: 1, root: '/project', complete: true, audience: 'graph', entries: [] };

it.live(
  'the production bundle emits the composed reader’s fold worker beside its host, and that worker shapes entries with the composed steps',
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'entry-kinds-')))),
        (made) => Effect.sync(() => rmSync(made, { recursive: true, force: true })),
      );
      const outputs = yield* bundle(join(import.meta.dir, 'testing', 'restedHost.ts'), 'host.js');
      expect(outputs.map((one) => one.name)).toContain('rested.worker.ts');
      for (const one of outputs) writeFileSync(join(root, one.name), one.text);
      const host: { readonly entryKinds: () => ThreadEntryReader } = yield* Effect.promise(
        () => import(pathToFileURL(join(root, 'host.js')).href),
      );
      const path = join(root, 'told.jsonl');
      const entry = {
        type: 'runtime-guidance',
        id: 'guidance',
        runId: 'run',
        hook: 'beforeStep',
        sequence: 1,
        texts: ['law'],
        sources: [{ hook: 'beforeStep', ruleId: 'prompt', state: { law } }],
      };
      const event = { position: 1, id: 'told', kind: 'runtime-guidance', payload: { entry } };
      writeFileSync(path, `${JSON.stringify({ thread: { id: 'told' } })}\n${JSON.stringify({ kind: 'event', row: event })}\n`);
      const transcript = `${path}.entries`;
      expect(yield* transcribeRollout(host.entryKinds(), { path, packed: `${path}.zst`, transcript }, { bytes: 0, position: 1 })).toBe(1);
      const written = JSON.parse(readFileSync(transcript, 'utf8').split('\n')[0]!) as {
        readonly sources: readonly { readonly state: unknown }[];
      };
      expect(written.sources[0]!.state).toEqual({ law: { '1': law } });
    }),
);
