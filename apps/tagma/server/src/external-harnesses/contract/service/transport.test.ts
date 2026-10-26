import { expect } from 'bun:test';
import { Effect } from 'effect';
import { it } from '@runlith/effect-test';
import { harnessArgv, harnessRoot, transportOf } from './table.js';

it.effect('transport resolution chooses a supported default and refuses an unavailable road before launch', () =>
  Effect.gen(function* () {
    expect((yield* transportOf('opencode')).transport).toBe('terminal');
    expect((yield* transportOf('opencode', 'acp')).agent).toBe('tagma');
    const fresh = yield* harnessArgv('opencode', null, 'thread-1', 'go');
    const root = harnessRoot('opencode', fresh);
    expect(root).toBe('ses_thread-1');
    expect(harnessRoot('opencode', yield* harnessArgv('opencode', root, 'thread-2', 'next'))).toBe(root);
    expect((yield* Effect.flip(transportOf('codex', 'acp'))).code).toBe('transport-unavailable');
    for (const name of ['claude-code', 'cursor', 'devin', 'codex'] as const) {
      expect((yield* transportOf(name)).transport).toBe('terminal');
    }
    for (const name of ['claude-code', 'cursor'] as const) {
      expect((yield* transportOf(name, 'acp')).agent).toBe('tagma');
    }
  }),
);
