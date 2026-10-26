import { describe, expect, test } from 'bun:test';
import { AgentGuidanceJournal } from './AgentGuidanceJournal';

describe('AgentGuidanceJournal', () => {
  test('assigns guidance stable run order and retains the source that must reach the model', () => {
    const journal = new AgentGuidanceJournal('run');
    const first = journal.emit(0, [{ text: 'First.', hook: 'beforeStep', ruleId: 'a' }]);
    const second = journal.emit(1, [{ text: 'Second.', hook: 'afterTool', toolCallId: 'tool' }]);
    expect(first).toMatchObject({
      runId: 'run',
      sequence: 1,
      stepNumber: 0,
      texts: ['First.'],
      sources: [{ hook: 'beforeStep', ruleId: 'a' }],
    });
    expect(second).toMatchObject({ sequence: 2, stepNumber: 1, sources: [{ hook: 'afterTool', toolCallId: 'tool' }] });
  });

  test('a closed journal ends guidance emission', () => {
    const journal = new AgentGuidanceJournal('run');
    journal.emit(0, [{ text: 'Said.', hook: 'beforeStep' }]);
    journal.close();
    expect(journal.emit(1, [{ text: 'Late.', hook: 'beforeStep' }])).toBeNull();
  });
});
