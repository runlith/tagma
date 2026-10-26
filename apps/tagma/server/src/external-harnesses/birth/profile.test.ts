import { expect } from 'bun:test';
import { Effect } from 'effect';
import { it } from '@runlith/effect-test';
import { profileOf } from './profile.js';
import { transportOf } from '../contract/service/table.js';

it.effect('a harness profile is refused at birth where its CLI could not honour it, and kept whole where it can', () =>
  Effect.gen(function* () {
    const unseen = yield* Effect.flip(
      profileOf('codex', { home: '/profiles/codex', plain: true }, yield* transportOf('codex', 'terminal')),
    );
    expect(unseen.code).toBe('profile-unsupported');
    const shared = yield* Effect.flip(profileOf('claude-code', { plain: true }, yield* transportOf('claude-code', 'terminal')));
    expect(shared.code).toBe('profile-home');
    const homeless = yield* Effect.flip(profileOf('gemini', { home: '/profiles/gemini' }, yield* transportOf('gemini', 'terminal')));
    expect(homeless.code).toBe('profile-unsupported');
    const hosted = yield* Effect.flip(profileOf('claude-code', { home: '/profiles/classic' }, yield* transportOf('claude-code', 'acp')));
    expect(hosted.code).toBe('profile-transport');
    const unknownMode = yield* Effect.flip(
      profileOf('claude-code', { permissionMode: 'yolo' }, yield* transportOf('claude-code', 'terminal')),
    );
    expect(unknownMode.code).toBe('profile-permission');
    const modeless = yield* Effect.flip(profileOf('codex', { permissionMode: 'auto' }, yield* transportOf('codex', 'terminal')));
    expect(modeless.code).toBe('profile-permission');
    const kept = { home: '/profiles/classic', plain: true, permissionMode: 'manual' };
    expect(yield* profileOf('claude-code', kept, yield* transportOf('claude-code', 'terminal'))).toEqual(kept);
  }),
);
