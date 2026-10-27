import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { harnessAdapter } from '../contract/service/table.js';
import type { MetadataInput } from '../metadata/sources.js';
import { readTail } from './read.js';
import { endsSource } from './table.js';

class Home extends Context.Service<Home, string>()('test/external-harnesses/ends/Home') {}

const home = Layer.effect(
  Home,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return yield* files.makeTempDirectoryScoped({ prefix: 'ends-' });
  }),
).pipe(Layer.provideMerge(MemoryFileSystem.layer));

const START = Date.parse('2026-10-08T22:00:10.000Z');
const at = (seconds: number): string => new Date(START + seconds * 1000).toISOString();
const input = (transcriptPath: string): MetadataInput => ({
  rootKey: 'session-1',
  cwd: '/work/project',
  execution: { execution: 'exec-1', incarnation: 1 },
  storage: { binding: {} as MetadataInput['storage']['binding'], entries: [] },
  transcriptPath,
});

const readFrom = Effect.fnUntraced(function* (
  name: 'claude-code' | 'cursor' | 'devin',
  path: string,
  text: string,
  window: { since: number; offset: number | null },
  chunk: number,
) {
  const source = endsSource(harnessAdapter(name));
  if (source === null) return yield* Effect.die(`${name} has no transcript reader`);
  const files = yield* FileSystem.FileSystem;
  yield* files.writeFileString(path, text);
  return yield* readTail(files, source, input(path), { ...window, turn: null }, chunk);
});

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

layer(home)('transcript tails', (it) => {
  it.effect('a tail read walks back across chunk edges and multibyte text to the run’s answer, and not into an earlier turn', () =>
    Effect.gen(function* () {
      const path = join(yield* Home, 'claude.jsonl');
      const answer = (seconds: number, value: string) => ({
        type: 'assistant',
        timestamp: at(seconds),
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: value }] },
      });
      const text =
        line(answer(-60, 'старый ответ')) +
        line({ type: 'user', timestamp: at(1), message: { content: 'новое слово' } }) +
        line(answer(5, 'готово — ответ на новое слово')) +
        line({ type: 'system', subtype: 'turn_duration', timestamp: at(5) });
      expect(yield* readFrom('claude-code', path, text, { since: START, offset: null }, 7)).toEqual({
        _tag: 'Read',
        end: { _tag: 'Completed', message: 'готово — ответ на новое слово' },
      });
      expect(yield* readFrom('claude-code', path, line(answer(-60, 'старый ответ')), { since: START, offset: null }, 7)).toEqual({
        _tag: 'Read',
        end: { _tag: 'Open' },
      });
    }),
  );

  it.effect('a transcript without stamps is read from the byte offset the run opened at', () =>
    Effect.gen(function* () {
      const path = join(yield* Home, 'cursor.jsonl');
      const before = line({ type: 'turn_ended', status: 'aborted' }) + line({ role: 'user', message: { content: [] } });
      const after = line({ role: 'user', message: { content: [] } });
      const offset = Buffer.byteLength(before);
      expect(yield* readFrom('cursor', path, before + after, { since: START, offset }, 11)).toEqual({
        _tag: 'Read',
        end: { _tag: 'Open' },
      });
      expect(
        yield* readFrom('cursor', path, before + after + line({ type: 'turn_ended', status: 'aborted' }), { since: START, offset }, 11),
      ).toEqual({ _tag: 'Read', end: { _tag: 'Aborted' } });
    }),
  );

  it.effect('a Devin document is read whole, and a transcript that is not there is absent', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const path = join(root, 'devin.json');
      const document = JSON.stringify({
        steps: [
          { timestamp: at(1), source: 'user', message: 'go' },
          { timestamp: at(2), source: 'system', message: '[Response interrupted by user]' },
        ],
      });
      const source = endsSource(harnessAdapter('devin'));
      if (source === null) return yield* Effect.die('devin has no transcript reader');
      const located = { ...source, locate: () => ({ root, path }) };
      const files = yield* FileSystem.FileSystem;
      yield* files.writeFileString(path, document);
      const read = yield* readTail(files, located, input(path), { since: START, offset: null, turn: null });
      const absent = yield* readTail(files, { ...source, locate: () => ({ root, path: join(root, 'gone.json') }) }, input(path), {
        since: START,
        offset: null,
        turn: null,
      });
      expect({ read, absent }).toEqual({ read: { _tag: 'Read', end: { _tag: 'Aborted' } }, absent: { _tag: 'Absent' } });
    }),
  );
});
