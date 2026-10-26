import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { compressRollout, compressedRollout, openRollout, releaseRollout, rolloutStateOf, rolloutThreadId } from './rolloutForms.js';

const rollout = (threadId: string): string =>
  [
    JSON.stringify({ thread: { id: threadId }, facet: null, session: null }),
    ...Array.from({ length: 500 }, (_, at) =>
      JSON.stringify({
        kind: 'event',
        row: { threadId, position: at + 1, id: `e-${at}`, kind: 'message', payload: { text: 'the same words again' } },
      }),
    ),
  ].join('\n') + '\n';

const written = (threadId: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'rollout-forms-')), `${threadId}.jsonl`);
  writeFileSync(path, rollout(threadId));
  return path;
};

describe('the two forms of a rollout', () => {
  it.live('the compressed form opens back to the same bytes, and one form stands at a time', () =>
    Effect.gen(function* () {
      const path = written('t-forms');
      const plain = readFileSync(path, 'utf8');

      yield* compressRollout(path);
      expect(existsSync(path)).toBe(false);
      expect(yield* rolloutStateOf(path)).toMatchObject({ form: 'compressed', path: compressedRollout(path) });
      expect((yield* rolloutStateOf(path))?.bytes ?? Infinity).toBeLessThan(Buffer.byteLength(plain, 'utf8'));

      yield* openRollout(path);
      expect(readFileSync(path, 'utf8')).toBe(plain);
      expect(existsSync(compressedRollout(path))).toBe(false);
      expect(yield* rolloutStateOf(path)).toMatchObject({ form: 'plain', bytes: Buffer.byteLength(plain, 'utf8') });
    }),
  );

  it.live('a frame beside a plain file is the leftover of a cut compression, and opening drops it', () =>
    Effect.gen(function* () {
      const path = written('t-leftover');
      const plain = readFileSync(path, 'utf8');
      yield* compressRollout(path);
      yield* openRollout(path);
      writeFileSync(compressedRollout(path), 'a frame from before');

      expect((yield* rolloutStateOf(path))?.form).toBe('plain');
      yield* openRollout(path);
      expect(readFileSync(path, 'utf8')).toBe(plain);
      expect(existsSync(compressedRollout(path))).toBe(false);
    }),
  );

  it.live('a rollout leaves in whichever form it stands', () =>
    Effect.gen(function* () {
      const path = written('t-gone');
      yield* compressRollout(path);
      yield* releaseRollout(path);
      expect(yield* rolloutStateOf(path)).toBeNull();
    }),
  );

  test('a rollout names its thread in both forms', () => {
    expect(rolloutThreadId('t-gone.jsonl.zst')).toBe('t-gone');
    expect(rolloutThreadId('t-gone.jsonl')).toBe('t-gone');
    expect(rolloutThreadId('t-gone.jsonl.opening')).toBeNull();
  });
});
