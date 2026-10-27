import type { HostEnding } from '@tagma/server/installation/contract/wire/newHost';
import { labelRevision } from '@tagma/server/installation/contract/wire/layout';

const NAMED = 3;

export type Said = { readonly text: string; readonly strong: boolean };

export type EndingGroup = { readonly title: string; readonly rows: readonly HostEnding[] };

export const shortBuild = (build: string): string => (labelRevision(build)?.head ?? build.split(' ')[0] ?? build).slice(0, 7);

export const buildName = (build: string): string => {
  const short = shortBuild(build);
  return /^\d+\.\d+/.test(short) ? `Tagma ${short}` : short;
};

const counted = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const listed = (parts: readonly Said[]): Said[] =>
  parts.flatMap((part, index) => [...(index === 0 ? [] : [{ text: index === parts.length - 1 ? ' and ' : ', ', strong: false }]), part]);

export const endsSaid = (ends: readonly HostEnding[]): Said[] => {
  const programs = ends.filter((ending) => ending.activity === 'program');
  const named: Said[] = programs.slice(0, NAMED).map((ending) => ({ text: ending.title, strong: true }));
  const more = programs.length - named.length;
  const head = more > 0 ? [...named, { text: `${more} more`, strong: false }] : named;
  const commands = ends.filter((ending) => ending.activity === 'command');
  const others = [
    counted(ends.filter((ending) => ending.activity === 'unread').length, 'terminal'),
    counted(ends.filter((ending) => ending.activity === 'shell').length, 'idle shell'),
    counted(commands.length, commands.every((ending) => ending.thread !== null) ? 'agent command' : 'command'),
  ]
    .filter((text) => !text.startsWith('0 '))
    .map((text) => ({ text, strong: false }));
  if (head.length === 0) return listed(others);
  if (others.length === 0) return listed(head);
  return [...listed(head), { text: ', plus ', strong: false }, ...listed(others)];
};

export const endingGroups = (ends: readonly HostEnding[]): EndingGroup[] =>
  (
    [
      { title: 'Running', rows: ends.filter((ending) => ending.activity === 'program') },
      { title: 'Terminals', rows: ends.filter((ending) => ending.activity === 'unread') },
      { title: 'Agent commands', rows: ends.filter((ending) => ending.activity === 'command') },
      { title: 'Idle shells', rows: ends.filter((ending) => ending.activity === 'shell') },
    ] satisfies EndingGroup[]
  ).filter((group) => group.rows.length > 0);

export const namesAll = (ends: readonly HostEnding[]): boolean =>
  ends.length <= NAMED && ends.every((ending) => ending.activity === 'program');
