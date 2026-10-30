import { expect, test } from 'bun:test';
import { geminiTerminal } from './gemini';

const { launch, hooks } = geminiTerminal;

test('Gemini resumes its session with the approval stance and refuses model choices it cannot spell', () => {
  expect(launch.interactive('do it')).toEqual(['gemini', '--approval-mode', 'yolo', 'do it']);
  expect(launch.resume('root-4', 'go')).toEqual(['gemini', '--approval-mode', 'yolo', '--resume', 'root-4', 'go']);
  expect(launch.root(launch.resume('root-4', 'go'))).toBe('root-4');
  expect(() => launch.resume('root-4', 'go', { model: 'flash', rung: 'high' })).toThrow(/no model surface/);
  expect(() => launch.interactive('go', { model: 'flash', rung: null })).toThrow(/no model surface/);
});

test('Gemini hook events classify session, turn, activity and permission notifications for the driver', () => {
  const occasion = geminiTerminal.occasionOf;
  const events = hooks!.events;
  expect(
    [events.sessionStart!, events.prompt!, events.preWrite!, events.postWrite!, events.stop!, events.sessionEnd!].map((name) =>
      occasion({ name }),
    ),
  ).toEqual(['session-start', 'turn-start', 'activity', 'activity', 'turn-end', 'turn-end']);
  expect(occasion({ name: 'Notification', notification: 'ToolPermission' })).toBe('wait');
  expect(occasion({ name: 'Notification' })).toBe('self-description');
  expect(occasion({ name: 'whatever-arrives-next' })).toBe('self-description');
  expect(geminiTerminal.sessionKeyOf({ hook_event_name: 'BeforeAgent', session_id: 'gem-1' })).toBe('gem-1');
  expect(geminiTerminal.turnOf({ hook_event_name: 'BeforeAgent', session_id: 'gem-1' })).toBeNull();
});

test('Gemini hook answers carry decisions and context in the CLI envelopes', () => {
  const codec = hooks!.codec;
  expect(JSON.parse(codec.permission({ allowed: true, words: 'permitted' }))).toEqual({ decision: 'approve', reason: 'permitted' });
  expect(JSON.parse(codec.permission({ allowed: false, words: 'refused' }))).toEqual({ decision: 'deny', reason: 'refused' });
  expect(JSON.parse(codec.context('session context'))).toEqual({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'session context' },
  });
  expect(JSON.parse(codec.tool('before context', 'before'))).toEqual({
    hookSpecificOutput: { hookEventName: 'BeforeTool', additionalContext: 'before context' },
  });
  expect(JSON.parse(codec.tool('after context', 'after'))).toEqual({
    hookSpecificOutput: { hookEventName: 'AfterTool', additionalContext: 'after context' },
  });
});

const WIDGET = ['Allow this tool?', '● 1. Allow once', '  2. Allow for this session', '  3. No, suggest changes (esc)'] as const;

test('Gemini confirmation reads the complete choice and answers by its number', () => {
  const ask = geminiTerminal.screenAskOf(WIDGET)!;
  expect(ask).toEqual({
    kind: 'choice',
    prompt: 'Allow this tool?',
    header: null,
    subject: null,
    options: [
      { value: '1', label: 'Allow once' },
      { value: '2', label: 'Allow for this session' },
      { value: '3', label: 'No, suggest changes (esc)' },
    ],
    selected: '1',
  });
  expect(geminiTerminal.keysOf(ask, ['3'])).toEqual([{ _tag: 'char', char: '3' }]);
  expect(geminiTerminal.keysOf({ ...ask, selected: null }, ['3'])).toEqual([{ _tag: 'char', char: '3' }]);
  expect(geminiTerminal.keysOf(ask, ['9'])).toBeNull();
  expect(geminiTerminal.cancelKeysOf(ask)).toEqual(['esc']);
  expect(geminiTerminal.screenAskOf(['  1. Allow once', '  2. Allow for this session'])).toBeNull();
  expect(geminiTerminal.screenAskOf(WIDGET.slice(0, -1))).toBeNull();
});
