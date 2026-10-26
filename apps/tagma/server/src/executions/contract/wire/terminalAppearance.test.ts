import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';
import { TerminalColorOverrides, terminalColorOverrides } from './terminalAppearance.js';

describe('the colour slots of terminal.colorOverrides', () => {
  const control = terminalColorOverrides.control;
  const offered = control?.kind === 'colors' ? control.groups.flatMap((group) => group.slots.map((slot) => slot.key)) : [];

  it('is one set: what a surface is offered is what the key accepts', () => {
    expect(control?.kind).toBe('colors');
    expect(new Set(offered).size).toBe(offered.length);
    expect([...offered].sort()).toEqual(Object.keys(TerminalColorOverrides.fields).sort());
  });

  it('holds every slot optional, so the record a person has set nothing in is the key’s own value', () => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(TerminalColorOverrides)(terminalColorOverrides.fallback))).toBe(true);
    expect(Result.isSuccess(Schema.decodeUnknownResult(TerminalColorOverrides)({ foreground: '#fff' }))).toBe(true);
  });

  it('takes a hex and nothing else, so a half-typed value never lands as a colour', () => {
    expect(Result.isFailure(Schema.decodeUnknownResult(TerminalColorOverrides)({ foreground: '#ff00' }))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(TerminalColorOverrides)({ foreground: 'red' }))).toBe(true);
  });
});
