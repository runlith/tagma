import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { commandDescriptions } from './commandDescriptions.js';

it.effect('a run keeps its command description policy through later tool readings', () =>
  Effect.gen(function* () {
    const descriptions = commandDescriptions();
    expect(yield* descriptions.of({ kind: 'run', runId: 'run-1', context: null }, Effect.succeed('required'))).toBe('required');
    expect(yield* descriptions.of({ kind: 'tools', runId: 'run-1', context: null }, Effect.succeed('optional'))).toBe('required');
    expect(yield* descriptions.of({ kind: 'run', runId: 'run-2', context: null }, Effect.succeed('optional'))).toBe('optional');
  }),
);

it.effect('relaunching a parked run keeps its policy until the run settles', () =>
  Effect.gen(function* () {
    const descriptions = commandDescriptions();
    const opening = { kind: 'run', runId: 'run-1', context: null } as const;
    const tools = { kind: 'tools', runId: 'run-1', context: null } as const;
    yield* descriptions.of(opening, Effect.succeed('required'));
    expect(yield* descriptions.of(opening, Effect.succeed('optional'))).toBe('required');
    yield* descriptions.release('run-1');
    expect(yield* descriptions.of(tools, Effect.succeed('optional'))).toBe('optional');
    expect(yield* descriptions.of({ kind: 'tools', runId: null, context: null }, Effect.succeed('required'))).toBe('required');
  }),
);
