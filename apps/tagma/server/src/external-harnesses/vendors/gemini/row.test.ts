import { expect, test } from 'bun:test';
import { gemini } from './row.js';

test('gemini declares the documented surface and classifies the timer path from it', () => {
  expect(gemini.hooks).toMatchObject({
    file: '.gemini/settings.json',
    format: 'gemini',
    events: {
      sessionStart: 'SessionStart',
      preWrite: 'BeforeTool',
      postWrite: 'AfterTool',
      postRead: 'AfterTool',
      stop: 'AfterAgent',
      permission: null,
      prompt: 'BeforeAgent',
      sessionEnd: 'SessionEnd',
      notification: 'Notification',
    },
  });
  expect(gemini.occasionOf({ name: 'SessionStart' })).toBe('session-start');
  expect(gemini.occasionOf({ name: 'BeforeAgent' })).toBe('turn-start');
  expect(gemini.occasionOf({ name: 'BeforeTool', tool: 'run_shell_command' })).toBe('activity');
  expect(gemini.occasionOf({ name: 'AfterTool', tool: 'read_file' })).toBe('activity');
  expect(gemini.occasionOf({ name: 'AfterAgent' })).toBe('turn-end');
  expect(gemini.occasionOf({ name: 'SessionEnd' })).toBe('turn-end');
  expect(gemini.occasionOf({ name: 'Notification', notification: 'ToolPermission' })).toBe('wait');
  expect(gemini.occasionOf({ name: 'Notification' })).toBe('self-description');
  expect(gemini.occasionOf({ name: 'whatever-arrives-next' })).toBe('self-description');
  expect(gemini.sessionKeyOf({ hook_event_name: 'BeforeAgent', session_id: 'gem-1' })).toBe('gem-1');
  expect(gemini.turnOf({ hook_event_name: 'BeforeAgent', session_id: 'gem-1' })).toBeNull();
});
