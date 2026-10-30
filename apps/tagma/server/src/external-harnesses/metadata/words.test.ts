import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { harnessAdapter } from '../contract/service/table.js';
import type { WordsSource } from '@runlith/tagma/adapter/metadata';
import { MetadataFile } from './file.js';
import { DOCUMENT_LIMITS, TRANSCRIPT_LIMITS } from './policy.js';
import { heardWords } from './words.js';
import { inputWords } from '../adapter/input.js';
import type { MetadataInput } from './input.js';

class Home extends Context.Service<Home, string>()('test/external-harnesses/metadata/WordsHome') {}

const home = Layer.effect(
  Home,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return yield* files.makeTempDirectoryScoped({ prefix: 'words-' });
  }),
).pipe(Layer.provideMerge(MemoryFileSystem.layer));

const input = (rootKey: string, over: Partial<MetadataInput>): MetadataInput => ({
  rootKey,
  cwd: '/work/project',
  execution: { execution: 'exec-1', incarnation: 1 },
  storage: { binding: {} as MetadataInput['storage']['binding'], entries: [] },
  ...over,
});

const readWords = Effect.fnUntraced(function* (name: 'devin' | 'claude-code' | 'codex', rootKey: string, fileName: string, text: string) {
  const dir = yield* Home;
  const file = join(dir, fileName);
  const declared = harnessAdapter(name).metadata?.words?.sources;
  if (declared === undefined) return yield* Effect.die(new Error(`${name} declares no reader-word source`));
  const over: Partial<MetadataInput> = name === 'devin' ? { rootKey, exportPath: file } : { rootKey, transcriptPath: file };
  const source = declared(input(rootKey, over)).find(
    (entry): entry is WordsSource & { root: string; path: string } => entry.root !== null && entry.path === file,
  );
  if (source === undefined) return yield* Effect.die(new Error(`${name} declares no source at ${file}`));
  const files = yield* FileSystem.FileSystem;
  yield* files.writeFileString(file, text);
  const cursor = new MetadataFile(source.fold, source.fold.json === true ? DOCUMENT_LIMITS : TRANSCRIPT_LIMITS);
  let page = yield* cursor.read(files, source.root, source.path);
  while (page._tag === 'Read' && !page.complete) page = yield* cursor.read(files, source.root, source.path);
  return page._tag === 'Read' ? { ...page, value: heardWords(page.value) } : page;
});

const atif = (sessionId: string, steps: readonly { source: string; message: unknown }[]) =>
  JSON.stringify({ schema_version: 'ATIF-v1.7', session_id: sessionId, agent: { model_name: 'SWE-2 Max' }, steps });

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

layer(home)('reader words', (it) => {
  it.effect('a Devin export reads the reader steps and nothing the CLI wrapped them in', () =>
    Effect.gen(function* () {
      const page = yield* readWords(
        'devin',
        'devin-1',
        'devin-export.json',
        atif('devin-1', [
          { source: 'user', message: 'fix the black gap under the terminal' },
          { source: 'user', message: [{ type: 'text', text: 'and pin the footer' }] },
          { source: 'agent', message: 'working on it' },
          { source: 'user', message: '<command-name>init</command-name>' },
          { source: 'system', message: 'you are Devin' },
        ]),
      );
      expect(page).toMatchObject({
        _tag: 'Read',
        complete: true,
        value: { words: ['fix the black gap under the terminal', 'and pin the footer'] },
      });
    }),
  );

  it.effect('a Devin export naming another session is refused by identity', () =>
    Effect.gen(function* () {
      const page = yield* readWords(
        'devin',
        'devin-1',
        'devin-foreign.json',
        atif('devin-other', [{ source: 'user', message: 'words of a different session' }]),
      );
      expect(page).toEqual({ _tag: 'Unreadable', reason: 'identity' });
    }),
  );

  it.effect('a Claude transcript reads user entries, skips sidechains, injected context and the records that carry no message', () =>
    Effect.gen(function* () {
      const page = yield* readWords(
        'claude-code',
        'claude-1',
        'claude-transcript.jsonl',
        [
          line({ type: 'mode', sessionId: 'claude-1', mode: 'default' }),
          line({ type: 'user', sessionId: 'claude-1', message: { role: 'user', content: 'explain the title delay' } }),
          line({ type: 'last-prompt', sessionId: 'claude-1', lastPrompt: 'explain the title delay' }),
          line({
            type: 'user',
            sessionId: 'claude-1',
            isSidechain: true,
            message: { role: 'user', content: 'a forked side conversation' },
          }),
          line({
            type: 'assistant',
            sessionId: 'claude-1',
            message: { role: 'assistant', content: [{ type: 'text', text: 'the export lands late' }] },
          }),
          line({
            type: 'user',
            sessionId: 'claude-1',
            message: { role: 'user', content: [{ type: 'text', text: '# AGENTS.md instructions for /work/project' }] },
          }),
          line({
            type: 'user',
            sessionId: 'claude-1',
            message: {
              role: 'user',
              content: [
                { type: 'tool_result', content: 'tool output' },
                { type: 'text', text: 'then adopt it' },
              ],
            },
          }),
        ].join(''),
      );
      expect(page).toMatchObject({ _tag: 'Read', complete: true, value: { words: ['explain the title delay', 'then adopt it'] } });
    }),
  );

  it.effect('a Claude transcript proves only complete root input blocks, including when its prompt hook was lost', () =>
    Effect.gen(function* () {
      const full = inputWords('envelope:complete', 'Я'.repeat(20_000));
      const partial = inputWords('envelope:partial', 'a truncated delivery').slice(0, -12);
      const side = inputWords('envelope:side', 'a side conversation');
      const page = yield* readWords(
        'claude-code',
        'claude-1',
        'claude-inputs.jsonl',
        [
          { type: 'user', sessionId: 'claude-1', message: { content: `${partial}\n${full}` } },
          { type: 'user', sessionId: 'claude-1', isSidechain: true, message: { content: side } },
        ]
          .map((row) => JSON.stringify(row) + '\n')
          .join(''),
      );
      expect(page).toMatchObject({ _tag: 'Read', value: { inputs: ['envelope:complete'] } });
    }),
  );

  it.effect('a Claude transcript entry naming another session refuses the whole reading', () =>
    Effect.gen(function* () {
      const page = yield* readWords(
        'claude-code',
        'claude-1',
        'claude-foreign.jsonl',
        line({ type: 'user', sessionId: 'claude-2', message: { role: 'user', content: 'not this session' } }),
      );
      expect(page).toEqual({ _tag: 'Unreadable', reason: 'identity' });
    }),
  );

  it.effect('a Codex rollout reads user input_text under the session its meta names', () =>
    Effect.gen(function* () {
      const page = yield* readWords(
        'codex',
        'codex-1',
        'codex-rollout.jsonl',
        [
          line({ type: 'session_meta', payload: { id: 'codex-1' } }),
          line({
            type: 'response_item',
            payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>' }] },
          }),
          line({
            type: 'response_item',
            payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'name this thread' }] },
          }),
          line({
            type: 'response_item',
            payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] },
          }),
        ].join(''),
      );
      expect(page).toMatchObject({ _tag: 'Read', complete: true, value: { words: ['name this thread'] } });
    }),
  );

  it.effect('a Codex rollout whose meta names another session is refused by identity', () =>
    Effect.gen(function* () {
      const page = yield* readWords('codex', 'codex-1', 'codex-foreign.jsonl', line({ type: 'session_meta', payload: { id: 'codex-2' } }));
      expect(page).toEqual({ _tag: 'Unreadable', reason: 'identity' });
    }),
  );

  it.effect('vendors carrying no readable reader-word source declare none', () =>
    Effect.sync(() => {
      for (const name of ['grok', 'cursor', 'gemini'] as const) {
        expect(harnessAdapter(name).metadata?.words).toBeUndefined();
      }
    }),
  );
});
