import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { projectTerminal } from './projection.js';

it.effect('a terminal failure is classified at its owner into the gate code its reason names', () =>
  Effect.gen(function* () {
    const refused = new TerminalRefused({ reason: 'not-holder', message: 'this execution belongs elsewhere' });
    const projected = yield* Effect.flip(projectTerminal(Effect.fail(refused)));
    expect(projected.code).toBe('terminal-not-holder');
    expect(projected.reason).toBe(refused.message);
  }),
);

it.effect('a preclassified terminal gate crosses unchanged', () =>
  Effect.gen(function* () {
    const gate = new GateRefusal('terminal-unknown', 'No execution is named.', ['read the inventory']);
    expect(yield* Effect.flip(projectTerminal(Effect.fail(gate)))).toBe(gate);
  }),
);
