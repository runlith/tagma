import { type Tagged } from '../contract/wire/tags/roles.js';
import { isEnabled } from '../contract/wire/tags/law.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { type SubtreeShape } from '../contract/wire/standing.js';
import type { Crowded } from '../contract/wire/answers.js';
import { SCREEN_ROWS } from '../contract/wire/tags/pageRole.js';

export type BlockLine = Tagged & {
  readonly name: string;
  readonly title: string;
  readonly superseded?: boolean;
  readonly blocked?: boolean;
  readonly building?: boolean;
  readonly answered?: boolean;
  readonly deletedAt?: unknown;
  readonly stealth?: boolean;
  readonly displaced?: boolean;
};

export function blockLine(table: TagReading, row: BlockLine): string {
  const law = table.lawProjection(row);
  const marks = [
    row.stealth === true ? 'stealth' : '',
    row.displaced === true ? 'displaced: its team parent left the team tree' : '',
    row.superseded === true ? 'superseded' : '',
    row.answered === true ? 'answered' : '',
    row.blocked === true ? 'blocked' : '',
    row.building === true ? 'in work' : '',
    law !== null && !isEnabled(law, row) ? 'off' : '',
    row.deletedAt ? 'in the trash' : '',
  ].filter((mark) => mark.length > 0);
  const status = table.statusOf(row);
  const state = status === null ? '' : `/${status}`;
  const carried = row.tags.length === 0 ? 'note' : row.tags.map((tag) => `#${table.nameOf(tag)}`).join(' ');
  return `${row.name} [${carried}${state}]${marks.length > 0 ? ` (${marks.join(', ')})` : ''} ${row.title}`;
}

export function underParent(parentName: string | null | undefined, enclosing: string | null = null): string {
  return parentName === null || parentName === undefined || parentName === enclosing ? '' : ` · under ${parentName}`;
}

export function refsInLine(names: readonly string[]): string {
  return `refs ← ${names.join(', ')} — their sentences were written against what this said; read them`;
}

export function crowdedLine(page: Crowded): string {
  return `past a screen: ${page.parent} ${page.title} holds ${page.children} standing ${page.role} children, more than ${SCREEN_ROWS} — group them by subject under it in this work`;
}

export function outlineIndent(depth: number): string {
  return '  '.repeat(depth);
}

export function shapeLine(shape: SubtreeShape): string {
  return `${shape.blocks} blocks · depth ${shape.depth} · widest ${shape.widest}`;
}

export function syncLine(report: { readonly commit: string | null; readonly sessions: readonly string[]; readonly files: number }): string {
  if (report.commit === null) return 'nothing to commit — the tree already stands committed';
  const who = report.sessions.length === 0 ? '' : ` · ${report.sessions.join(', ')}`;
  return `${report.commit.slice(0, 10)} · ${report.files} file${report.files === 1 ? '' : 's'}${who}`;
}

export function pageFooter(shown: number, total: number, next?: string, order?: string): string {
  return `${shown} of ${total}${order === undefined ? '' : ` · ${order}`}${next === undefined ? '' : ` · next: ${next}`}`;
}
