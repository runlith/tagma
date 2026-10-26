import { GROUPS, type GroupId } from '$lib/app/panes/palette.js';

export type Chip = 'all' | GroupId;
export const CHIPS: readonly Chip[] = ['all', ...GROUPS];

export const GROUP_TITLES: Record<GroupId, string> = {
  projects: 'Projects',
  files: 'Files',
  threads: 'Threads',
  blocks: 'Blocks',
  commits: 'Commits',
  settings: 'Settings',
  actions: 'Actions',
};

const PREFIXES: Readonly<Record<string, GroupId | 'ask'>> = {
  '>': 'actions',
  '@': 'threads',
  '#': 'blocks',
  '?': 'ask',
};

export type Prefixed = {
  readonly aim: GroupId | 'ask' | null;
  readonly text: string;
};

export function prefixed(raw: string): Prefixed {
  const head = raw.trimStart();
  const aim = PREFIXES[head.charAt(0)];
  return aim === undefined ? { aim: null, text: raw.trim() } : { aim, text: head.slice(1).trim() };
}

export type Narrowed = {
  readonly text: string;
  readonly tag: string | null;
  readonly status: string | null;
};

export function narrowed(text: string, tags: readonly string[], statuses: readonly string[]): Narrowed {
  let tag: string | null = null;
  let status: string | null = null;
  const rest = text
    .replace(/\b(tag|status):(\S+)/g, (whole, key: string, value: string) => {
      const known = key === 'tag' ? tags.find((candidate) => candidate === value) : statuses.find((candidate) => candidate === value);
      if (known === undefined) return whole;
      if (key === 'tag') tag = known;
      else status = known;
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text: rest, tag, status };
}

export function nextChip(from: Chip, step: 1 | -1): Chip {
  const at = CHIPS.indexOf(from);
  return CHIPS[(at + step + CHIPS.length) % CHIPS.length] ?? 'all';
}
