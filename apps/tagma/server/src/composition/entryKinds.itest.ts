import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { bundle } from '@runlith/bundle/bundle';
import type { ThreadReaderModule } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from './manifest.js';

it.live('the composed entry reader names a module the production bundle emits beside its host, and that module rebuilds it', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'entry-kinds-')))),
      (made) => Effect.sync(() => rmSync(made, { recursive: true, force: true })),
    );
    for (const one of yield* bundle(join(import.meta.dir, 'entryKinds.ts'), 'host.js')) writeFileSync(join(root, one.name), one.text);
    const host: ThreadReaderModule = yield* Effect.promise(() => import(pathToFileURL(join(root, 'host.js')).href));
    const reader = host.entryKinds();
    expect(reader.source).toBe(pathToFileURL(join(root, 'entryKinds.ts')).href);
    const rebuilt: ThreadReaderModule = yield* Effect.promise(() => import(reader.source!));
    expect(rebuilt.entryKinds().last).toBe(ENTRY_KINDS.last);
  }),
);
