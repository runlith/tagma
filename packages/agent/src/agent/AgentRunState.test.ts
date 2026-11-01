import { describe, expect, test } from 'bun:test';
import { AgentRunState } from './AgentRunState';

describe('AgentRunState', () => {
  test('restores rule counters and the last streak from confirmed calls', () => {
    const state = new AgentRunState({
      stepsTaken: 3,
      priorTools: [
        { toolCallId: 'tool-1', toolName: 'search', input: {}, output: { status: 'ok' } },
        { toolCallId: 'tool-2', toolName: 'detail', input: {}, output: { status: 'ok' } },
      ],
    });
    expect(state.stepNumber).toBe(3);
    expect(state.calledAny(['search', 'missing'])).toBe(true);
    expect(state.count('search')).toBe(1);
    expect(state.streak('detail')).toBe(1);
  });

  test('counts admission once across the native step commit', () => {
    const state = new AgentRunState();
    state.noteToolCall('search', 'tool-1');
    state.noteToolCall('search', 'tool-1');
    state.commitStep();
    state.noteToolCall('search', 'tool-2');
    state.noteToolCall('detail', 'tool-3');
    state.commitStep();
    expect(state.stepNumber).toBe(2);
    expect(state.count('search')).toBe(2);
    expect(state.count('detail')).toBe(1);
    expect(state.streak('search')).toBe(0);
    expect(state.streak('detail')).toBe(1);
  });

  test('keeps exact rule summaries after hosted confirmations', () => {
    const state = new AgentRunState();
    const rule = state.ruleState('close', () => ({ reminded: true }));
    state.noteToolCall('search', 'tool-1');
    state.confirmed('tool-1');
    state.noteToolCall('search', 'tool-2');
    state.confirmed('tool-2');
    expect(state.called('search')).toBe(true);
    expect(state.count('search')).toBe(2);
    expect(state.streak('search')).toBe(2);
    expect(state.ruleState('close', () => ({ reminded: false }))).toBe(rule);
  });
});
