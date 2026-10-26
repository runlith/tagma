import { describe, expect, test } from 'bun:test';
import { capTranscriptEntry, WIRE_ENTRY_MAX_BYTES } from './cap';
import type { ThreadToolEntry } from './entries';

const call = (over: Partial<ThreadToolEntry>): ThreadToolEntry => ({
  type: 'tool',
  id: 'tool:call-1',
  toolName: 'read',
  toolCallId: 'call-1',
  toolState: 'output-available',
  ...over,
});

describe('capTranscriptEntry', () => {
  test('an entry under the ceiling crosses as the object it already was', () => {
    const entry = call({ toolOutput: { text: 'ok' } });

    expect(capTranscriptEntry(entry)).toBe(entry);
  });

  test('an oversized body is withheld, and the row is told how much', () => {
    const entry = call({
      toolOutput: { text: 'x'.repeat(WIRE_ENTRY_MAX_BYTES * 2) },
      toolDisplay: { form: 'text', title: 'a.ts', text: 'shown', facts: [{ label: 'lines', value: '3' }] },
    });

    const capped = capTranscriptEntry(entry) as ThreadToolEntry;

    expect(capped.toolOutput).toBeUndefined();
    expect(capped.truncated).toBeGreaterThan(WIRE_ENTRY_MAX_BYTES);
    expect(capped.toolDisplay?.title).toBe('a.ts');
    expect(capped.toolDisplay?.facts?.map((fact) => fact.label)).toEqual(['lines', 'withheld']);
    expect(JSON.stringify(capped).length).toBeLessThan(WIRE_ENTRY_MAX_BYTES);
  });

  test('a form whose own body is oversized keeps its head and loses its text', () => {
    const entry = call({
      toolDisplay: { form: 'code', title: 'big.ts', text: 'y'.repeat(WIRE_ENTRY_MAX_BYTES * 2) },
    });

    const capped = capTranscriptEntry(entry) as ThreadToolEntry;

    expect(capped.toolDisplay?.title).toBe('big.ts');
    expect(capped.toolDisplay?.form === 'code' ? capped.toolDisplay.text : null).toBe('');
    expect(JSON.stringify(capped).length).toBeLessThan(WIRE_ENTRY_MAX_BYTES);
  });

  test('an entry that is not a call is never cut', () => {
    const entry = { type: 'message', id: 'm1', role: 'assistant', text: 'z'.repeat(WIRE_ENTRY_MAX_BYTES * 2) };

    expect(capTranscriptEntry(entry)).toBe(entry);
  });
});
