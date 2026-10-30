import { expect, test } from 'bun:test';
import { MetadataInvalid, emptyValues, type MetadataLocation } from '@runlith/tagma/adapter/metadata';
import { grokTerminal } from './grok';
import started from './fixtures/session-start.json';
import source from './fixtures/source.summary.json';

const { launch } = grokTerminal;

test('a whole fork launches into the id reported by the recorded idle SessionStart', () => {
  const whole = launch.cut!.whole!;
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
  expect(grokTerminal.sessionKeyOf(started)).toBe(started.session_id);
  expect(grokTerminal.occasionOf({ name: started.hook_event_name })).toBe('session-start');
});

test('every launch carries the always-approve stance, and a model choice is refused because Grok takes no model words', () => {
  expect(launch.interactive('do it')).toEqual(['grok', '--always-approve', 'do it']);
  expect(launch.resume('root-4', 'go')).toEqual(['grok', '--always-approve', '--resume', 'root-4', 'go']);
  expect(launch.assign!('fresh-9', 'go')).toEqual(['grok', '--always-approve', '--session-id', 'fresh-9', 'go']);
  expect(launch.root(['grok', '--always-approve', '--session-id', 'fresh-9'])).toBe('fresh-9');
  expect(() => launch.resume('root-4', 'go', { model: 'grok-4.6', rung: 'high' })).toThrow(/no model surface/);
});

test('snake-case hook names classify like their Claude spellings, and a question tool waits the clock', () => {
  const occasion = grokTerminal.occasionOf;
  expect(['session_start', 'user_prompt_submit', 'stop', 'session_end', 'notification'].map((name) => occasion({ name }))).toEqual([
    'session-start',
    'turn-start',
    'turn-end',
    'turn-end',
    'self-description',
  ]);
  expect(occasion({ name: grokTerminal.hooks!.events.preWrite!, tool: 'AskUserQuestion' })).toBe('wait');
});

const box = (inside: string): readonly string[] => [
  '  ⠸ Run Node setTimeout for 20 seconds… 4.5s                         7.3s ⇣26.2k [↓][stop]',
  ` ╭${'─'.repeat(60)}╮`,
  inside,
  ` ╰${'─'.repeat(30)} Grok 4.5 (low) · always-approve ─╯`,
  ' Ctrl+x:shortcuts',
];

test('the Grok Build 1.0.62 composer reads the words standing in it and nothing for an empty box', () => {
  const composer = grokTerminal.composer!.of;
  expect([composer(box(` │ ❯${' '.repeat(57)}│`)), composer(box(` │ ❯ hello draft[Pasted: 3 lines]${' '.repeat(28)}│`))]).toEqual([
    null,
    'hello draft[Pasted: 3 lines]',
  ]);
});

const summaryOf = (rootKey: string): Extract<MetadataLocation, { readonly kind: 'file' }> => {
  const [summary] = grokTerminal.metadata!.sources({
    rootKey,
    cwd: '/work/proj',
    storage: { entries: [{ name: 'GROK_HOME', value: '/home/me/.grok' }] },
  });
  if (summary?.kind !== 'file') throw new Error('Grok reads its session summary from a file');
  return summary;
};

test('the session summary under GROK_HOME keeps its recorded model and title and refuses a foreign session', () => {
  const summary = summaryOf('grok-one');
  expect(summary.path).toBe('/home/me/.grok/sessions/%2Fwork%2Fproj/grok-one/summary.json');
  const text = JSON.stringify({ info: { id: 'grok-one' }, current_model_id: 'grok-4.6', generated_title: 'Summary' });
  expect(summary.fold.line(emptyValues(), text)).toMatchObject({
    model: { value: 'grok-4.6', claim: 'last-recorded' },
    title: { value: 'Summary' },
    effort: null,
  });
  expect(() => summaryOf('other').fold.line(emptyValues(), text)).toThrow(MetadataInvalid);
});
