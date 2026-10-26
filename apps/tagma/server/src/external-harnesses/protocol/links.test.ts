import { expect, test } from 'bun:test';
import { type Link, ProtocolLinks } from './links.js';
import { freshRow, type ProtocolRow } from './row.js';

const turned = (...ids: readonly string[]): ProtocolRow =>
  ({ ...freshRow('incarnation', null, null), turns: ids.map((id) => ({ id })) }) as unknown as ProtocolRow;

const linkOf = (threadId: string, row: ProtocolRow): Link => ({ threadId, row }) as unknown as Link;

test('a run is found by the thread whose link holds it, however the row changes, and not after the turn or the link is gone', () => {
  const links = new ProtocolLinks(null as never, null as never);
  const one = linkOf('thread-1', turned('run-1'));
  const other = linkOf('thread-2', turned('run-2'));
  links.set(one);
  links.set(other);
  expect(links.threadOf('run-1')).toBe('thread-1');
  expect(links.threadOf('run-2')).toBe('thread-2');
  expect(links.turned('run-3')).toBe(false);

  links.landed(one, turned('run-1', 'run-3'));
  expect(links.threadOf('run-3')).toBe('thread-1');

  links.landed(one, turned('run-3'));
  expect(links.turned('run-1')).toBe(false);
  expect(links.threadOf('run-3')).toBe('thread-1');
  expect(links.threadOf('run-2')).toBe('thread-2');

  links.drop('thread-1');
  expect(links.turned('run-3')).toBe(false);
  expect(links.threadOf('run-2')).toBe('thread-2');

  links.landed(one, turned('run-9'));
  expect(links.turned('run-9')).toBe(false);
});
