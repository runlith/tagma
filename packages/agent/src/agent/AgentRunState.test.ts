import { describe, expect, test } from 'bun:test';
import { AgentRunState } from './AgentRunState';

describe('AgentRunState', () => {
  test('seeds current run tool history from prior tool records', () => {
    const state = new AgentRunState({
      priorTools: [
        { toolCallId: 'tool-1', toolName: 'search_learning_objects', input: {}, output: { status: 'ok' } },
        { toolCallId: 'tool-2', toolName: 'get_learning_object_detail', input: {}, output: { status: 'ok' } },
      ],
    });

    expect(state.called('search_learning_objects')).toBe(true);
    expect(state.called('get_learning_object_detail')).toBe(true);
    expect(state.count('search_learning_objects')).toBe(1);
    expect(state.sequence(['search_learning_objects', 'get_learning_object_detail'])).toBe(true);
  });

  test('tracks tool calls idempotently', () => {
    const state = new AgentRunState();

    state.noteToolInput('search_learning_objects', { query: 'kafa' }, 'tool-1', 0);
    state.noteToolInput('search_learning_objects', { query: 'kafa' }, 'tool-1', 0);
    state.noteToolOutput('search_learning_objects', { results: [] }, 'tool-1', 0);

    expect(state.count('search_learning_objects')).toBe(1);
    expect(state.latestOutput('search_learning_objects')).toEqual({ results: [] });
    expect(state.toolsSoFar()[0]?.stepNumber).toBe(0);
  });

  test('commits step order for streak decisions', () => {
    const state = new AgentRunState();
    state.commitStep({
      toolCalls: [
        { toolCallId: 'tool-1', toolName: 'search_learning_objects', input: {} },
        { toolCallId: 'tool-2', toolName: 'search_learning_objects', input: {} },
        { toolCallId: 'tool-3', toolName: 'get_learning_object_detail', input: {} },
      ],
      toolResults: [],
    });

    expect(state.stepNumber).toBe(1);
    expect(state.toolsSoFar().map((record) => record.stepNumber)).toEqual([0, 0, 0]);
    expect(state.streak('search_learning_objects')).toBe(0);
    expect(state.streak('get_learning_object_detail')).toBe(1);
    expect(state.sequence(['search_learning_objects', 'get_learning_object_detail'])).toBe(true);
  });

  test('keeps the raw execution output when the persisted step contains a bounded projection', () => {
    const state = new AgentRunState();
    const raw = { results: Array.from({ length: 10_000 }, (_, index) => index) };
    state.noteToolInput('search', {}, 'tool-1', 0);
    state.noteToolOutput('search', raw, 'tool-1', 0);

    state.commitStep({
      toolCalls: [{ toolCallId: 'tool-1', toolName: 'search', input: {} }],
      toolResults: [{ toolCallId: 'tool-1', toolName: 'search', output: { truncated: true, outputId: 'output-1' } }],
    });

    expect(state.latestOutput('search')).toBe(raw);
  });
});
