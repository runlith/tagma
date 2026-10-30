import { expect, test } from 'bun:test';
import { grok } from './row.js';
import { harnessAnswer } from '../../contract/service/table.js';
import started from '../../testing/fixtures/grok/session-start.json';
import source from '../../testing/fixtures/grok/source.summary.json';

test('a whole fork launches into the id reported by the recorded idle SessionStart', () => {
  const whole = grok.launch.cut!.whole!;
  if (whole._tag !== 'Launch') throw new Error('Grok must fork at launch');
  expect(whole.argv({ root: source.info.id, address: null }, started.session_id)).toEqual([
    'grok',
    '--always-approve',
    '--resume',
    source.info.id,
    '--fork-session',
    '--session-id',
    started.session_id,
  ]);
  expect(grok.sessionKeyOf(started)).toBe(started.session_id);
  expect(grok.occasionOf({ name: started.hook_event_name })).toBe('session-start');
});

test('a grok turn-boundary payload delivers its answer', () => {
  const said = { lastAssistantMessage: 'PLUMBLINE-9d4c1f2' };
  expect(harnessAnswer(grok, said)).toBe('PLUMBLINE-9d4c1f2');
});
