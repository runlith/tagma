import { expect, test } from 'bun:test';
import { resolveEnvironment } from '@runlith/executions/CommandEnvironment';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { keyedEnvironment, requestedEnvironment, terminalEnvironment } from './environment.js';

const childOf = (bound: Record<string, string>, requested?: Parameters<typeof terminalEnvironment>[1]): Map<string, string> =>
  new Map(
    resolveEnvironment(new Map(Object.entries(bound)), terminalEnvironment('pty', requested, '1.2.3')).map((variable) => [
      variable.name,
      variable.value,
    ]),
  );

test('a pty tells its child which terminal it is in', () => {
  const environment = childOf({});
  expect(environment.get('TERM')).toBe('xterm-256color');
  expect(environment.get('COLORTERM')).toBe('truecolor');
  expect(environment.get('TERM_PROGRAM')).toBe('Tagma');
  expect(environment.get('TERM_PROGRAM_VERSION')).toBe('1.2.3');
  expect(environment.get('FORCE_HYPERLINK')).toBe('1');
  expect(terminalEnvironment('pty', undefined, '1.2.3').inherit).toBe(true);
  expect(childOf({ HOME: '/home/person' }).get('HOME')).toBe('/home/person');
});

test('a caller that names its own terminal keeps it', () => {
  const request = terminalEnvironment(
    'pty',
    {
      inherit: false,
      entries: [{ _tag: 'Set', name: 'TERM', value: 'dumb' }],
    },
    '1.2.3',
  );
  expect(new Map(resolveEnvironment(new Map(), request).map((one) => [one.name, one.value])).get('TERM')).toBe('dumb');
  expect(request.inherit).toBe(false);
});

test('a pipe execution is told nothing about a terminal it does not have', () => {
  const request = terminalEnvironment('pipes', { inherit: true, entries: [] }, '1.2.3');
  expect(request.entries).toEqual([]);
});

test('a pty without a locale is given one, and a locale already set is kept', () => {
  expect(childOf({}).get('LANG')).toBe('en_US.UTF-8');
  expect(childOf({ LANG: 'ru_RU.UTF-8' }).get('LANG')).toBe('ru_RU.UTF-8');
  expect(childOf({}, { inherit: true, entries: [{ _tag: 'Set', name: 'LANG', value: 'C' }] }).get('LANG')).toBe('C');
});

test('a parent’s colour opt-out is not inherited by a pane, and its opt-in is', () => {
  const stripped = childOf({ NO_COLOR: '1', FORCE_COLOR: '0', CLICOLOR: '0' });
  expect(stripped.has('NO_COLOR')).toBe(false);
  expect(stripped.has('FORCE_COLOR')).toBe(false);
  expect(stripped.has('CLICOLOR')).toBe(false);

  const kept = childOf({ FORCE_COLOR: '1', CLICOLOR: '1', NO_COLOR: '' });
  expect(kept.get('FORCE_COLOR')).toBe('1');
  expect(kept.get('CLICOLOR')).toBe('1');
  expect(kept.has('NO_COLOR')).toBe(false);

  expect(childOf({ NO_COLOR: '1' }, { inherit: true, entries: [{ _tag: 'Set', name: 'NO_COLOR', value: '1' }] }).get('NO_COLOR')).toBe('1');
});

test('an operator shell is born with its key and without any identity its parent carries; a harness launch keeps its own', () => {
  const bound = { TAGMA_SESSION_GRANT: 'server.grant', TAGMA_HARNESS_SESSION: 'server-session', TAGMA_TERMINAL: 'stale', HOME: '/Users/x' };
  const resolved = (request: Parameters<typeof keyedEnvironment>[0], key: string | undefined) =>
    new Map(
      resolveEnvironment(new Map(Object.entries(bound)), keyedEnvironment(request, key, testSessionIdentity)).map((one) => [
        one.name,
        one.value,
      ]),
    );
  const shell = resolved(terminalEnvironment('pty', undefined, '1.2.3'), 'the-key');
  expect(shell.has('TAGMA_SESSION_GRANT')).toBe(false);
  expect(shell.has('TAGMA_HARNESS_SESSION')).toBe(false);
  expect(shell.get('TAGMA_TERMINAL')).toBe('the-key');
  expect(shell.get('HOME')).toBe('/Users/x');
  const launch = resolved(requestedEnvironment({ TAGMA_SESSION_GRANT: 'thread.grant', TAGMA_HARNESS_SESSION: 'its-session' }), undefined);
  expect(launch.get('TAGMA_SESSION_GRANT')).toBe('thread.grant');
  expect(launch.get('TAGMA_HARNESS_SESSION')).toBe('its-session');
  expect(launch.has('TAGMA_TERMINAL')).toBe(false);
});

test('a start’s env map sets and unsets over the inherited environment', () => {
  const child = childOf(
    { TAGMA_SURFACE_OUT: '/frozen', HOME: '/Users/x' },
    requestedEnvironment({ TAGMA_SURFACE_OUT: null, PORT: '6111' }),
  );
  expect(child.has('TAGMA_SURFACE_OUT')).toBe(false);
  expect(child.get('PORT')).toBe('6111');
  expect(child.get('HOME')).toBe('/Users/x');
});
