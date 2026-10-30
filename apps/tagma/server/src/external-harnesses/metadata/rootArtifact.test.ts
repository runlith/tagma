import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { builtinHarness } from '../testing/builtin.js';
import { readRootArtifact } from './rootArtifact.js';

class Home extends Context.Service<Home, string>()('test/external-harnesses/metadata/RootArtifactHome') {}

const home = Layer.effect(
  Home,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return yield* files.makeTempDirectoryScoped({ prefix: 'root-artifact-' });
  }),
).pipe(Layer.provideMerge(MemoryFileSystem.layer));

const codex = builtinHarness('codex');
const ROOT = '01a0ab90-4444-7000-8000-00000000f00d';

const meta = (id: string) =>
  `${JSON.stringify({ timestamp: '2026-09-16T00:00:00.000Z', ordinal: 0, type: 'session_meta', payload: { id } })}\n`;

const reading = Effect.fnUntraced(function* (name: string, text?: string, root: string = ROOT, adapter = codex) {
  const files = yield* FileSystem.FileSystem;
  const dir = yield* Home;
  const path = join(dir, name);
  if (text !== undefined) yield* files.writeFileString(path, text);
  return yield* readRootArtifact(files, adapter.metadata, root, path);
});

layer(home)('root artifact', (it) => {
  it.effect('an artifact that opens on the minted session binds it', () =>
    Effect.gen(function* () {
      expect(yield* reading('bound.jsonl', meta(ROOT))).toEqual({ _tag: 'Bound' });
    }),
  );

  it.effect('an artifact naming another session is refused, and the same file binds the session it does name', () =>
    Effect.gen(function* () {
      const other = '01a0ab90-5555-7000-8000-00000000dead';
      expect((yield* reading('foreign.jsonl', meta(other)))._tag).toBe('Refused');
      expect(yield* reading('foreign.jsonl', undefined, other)).toEqual({ _tag: 'Bound' });
    }),
  );

  it.effect('an artifact the mint named and nothing wrote is refused', () =>
    Effect.gen(function* () {
      expect((yield* reading('never-written.jsonl'))._tag).toBe('Refused');
    }),
  );

  it.effect('a file that carries no session of its own proves no root', () =>
    Effect.gen(function* () {
      const text = `${JSON.stringify({ timestamp: 't', ordinal: 0, type: 'response_item', payload: {} })}\n`;
      expect((yield* reading('turns-only.jsonl', text))._tag).toBe('Refused');
    }),
  );

  it.effect('a Claude Code fork binds the session it was written for, and its source does not bind it', () =>
    Effect.gen(function* () {
      const claude = builtinHarness('claude-code');
      const copy = '1fc80a2c-3ad0-4331-a75b-15fd97028d6a';
      const origin = 'c252b18d-e481-452e-8449-a632720da358';
      const said = (sessionId: string, content: string) =>
        `${JSON.stringify({ parentUuid: null, isSidechain: false, type: 'user', sessionId, message: { role: 'user', content } })}\n`;
      const answered = `${JSON.stringify({ parentUuid: null, isSidechain: false, type: 'assistant', sessionId: copy, message: { model: 'claude-opus-5' } })}\n`;
      expect(yield* reading('copy.jsonl', said(copy, 'go') + answered, copy, claude)).toEqual({ _tag: 'Bound' });
      expect((yield* reading('source.jsonl', said(origin, 'go'), copy, claude))._tag).toBe('Refused');
      expect(yield* reading('pictured.jsonl', said(copy, 'x'.repeat(300 * 1024)) + answered, copy, claude)).toEqual({ _tag: 'Bound' });
    }),
  );
});
