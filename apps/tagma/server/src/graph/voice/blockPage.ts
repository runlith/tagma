import { blockLine, outlineIndent, pageFooter, shapeLine, underParent } from './lines.js';
import { type SessionIdentity, type SessionRef, sessionName } from '../../platform/contract/wire/session.js';
import type { BlockRead } from '../contract/wire/rows.js';
import type { FarEnd } from '../contract/wire/far.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { plainLines } from '../../platform/contract/wire/plainText.js';
import { WORK } from '../contract/wire/tags/work.js';
import { lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';

export type BlockPageTextOptions = {
  readonly writers?: ReadonlyMap<number, string>;
  readonly outlineRows?: number;
};

const writerName = (writer: SessionRef | null, identity: SessionIdentity['Service']): string =>
  writer === null ? 'operator' : sessionName(writer, identity);

export function payloadLines(table: TagReading, node: Pick<BlockRead, 'tags' | 'fields'>): string[] {
  const shown = Object.entries(node.fields).filter(([name]) => isPayloadField(table, node, name));
  return shown.length === 0 ? [] : plainLines(Object.fromEntries(shown.map(([name, value]) => [shownName(table, node, name), value])));
}

function shownName(table: TagReading, node: Pick<BlockRead, 'tags'>, key: string): string {
  const declaring = table.tagsOf(node).find((tag) => tag.fields[key] !== undefined);
  return declaring === undefined ? key : table.fieldNameOf(declaring.id, key);
}

function isPayloadField(table: TagReading, node: Pick<BlockRead, 'tags'>, name: string): boolean {
  const tags = table.tagsOf(node);
  const lineShown = tags.some((tag) => lifecycleOf(tag)?.field === name || tag.contracts?.[HOLDER]?.slots[HOLDER_SLOT] === name);
  return !lineShown && tags.some((tag) => tag.fields[name] !== undefined);
}

function outline(
  table: TagReading,
  parent: string,
  children: readonly BlockRead[],
  depth: number,
  window: { left: number; cut: number },
  lines: string[],
): void {
  for (const child of children) {
    if (window.left <= 0) {
      window.cut += 1;
    } else {
      window.left -= 1;
      lines.push(`${outlineIndent(depth)}${blockLine(table, child)}${underParent(child.parentName, parent)}`);
    }
    outline(table, child.name, child.children, depth + 1, window, lines);
  }
}

function farEndText(end: FarEnd | undefined): string {
  if (end === undefined) return '';
  return end.state === 'here' ? ` · ${end.project} «${end.title ?? ''}»` : ` — ${end.reason ?? `${end.project} is not on this machine`}`;
}

function restingLine(resting: BlockRead['restingIn'], name: string): string | null {
  const groups = new Map<string, string[]>();
  if (resting.refsDetails.length > 0)
    groups.set(
      'refs',
      resting.refsDetails.map((ref) => ref.name),
    );
  for (const edge of resting.edges) {
    const names = groups.get(edge.kind) ?? [];
    names.push(edge.toName === name ? edge.fromName : `${edge.fromName} → ${edge.toName}`);
    groups.set(edge.kind, names);
  }
  if (groups.size === 0) return null;
  const said = [...groups].map(([kind, names]) => `${names.length} ${kind} (${names.join(', ')})`).join(', ');
  return `← from finished or replaced blocks: ${said}`;
}

export function blockPageText(
  table: TagReading,
  view: BlockRead,
  identity: SessionIdentity['Service'],
  options: BlockPageTextOptions = {},
): string {
  const lines: string[] = [`${blockLine(table, view)}${underParent(view.parentName)}`];
  const holder = table.holderOf(view);
  if (table.standsAt(view, WORK, 'active')) {
    lines.push(`held by ${holder === null ? 'operator' : (options.writers?.get(holder) ?? 'a session')}`);
  }
  for (const edge of view.edgesOut)
    lines.push(`${edge.fromName === view.name ? '' : `${edge.fromName} `}→ ${edge.kind} ${edge.toName}${farEndText(edge.graph)}`);
  for (const edge of view.edgesIn)
    lines.push(`← ${edge.fromName}${farEndText(edge.graph)} ${edge.kind}${edge.toName === view.name ? '' : ` → ${edge.toName}`}`);
  if ((view.edgesInUnread?.length ?? 0) > 0) lines.push(`← not read yet from ${view.edgesInUnread!.join(', ')}`);
  for (const measured of view.sources) {
    lines.push(`source[${measured.kind}]: ${measured.ref}${measured.symbol ? `#${measured.symbol}` : ''}`);
  }
  if (view.reach !== null) lines.push(`delivered: ${view.reach}`);
  lines.push(...payloadLines(table, view));
  const elsewhere = new Map(
    (view.refsElsewhere ?? []).map((ref) => [ref.name, ref.branch === null ? ref.project : `${ref.project}@${ref.branch}`] as const),
  );
  const outNames = view.refsOutDetails.map((ref) => ref.name);
  const named = new Set(outNames);
  const refsOut = [
    ...outNames.map((name) => (elsewhere.has(name) ? `${name} · ${elsewhere.get(name)}` : name)),
    ...[...elsewhere].filter(([name]) => !named.has(name)).map(([name, place]) => `${name} · ${place}`),
    ...(view.refsAbsent ?? []).map((name) => `${name} — not on this machine`),
  ];
  if (refsOut.length > 0) lines.push(`refs → ${refsOut.join(', ')}`);
  if (view.refsInDetails.length > 0) lines.push(`refs ← ${view.refsInDetails.map((ref) => ref.name).join(', ')}`);
  const resting = restingLine(view.restingIn, view.name);
  if (resting !== null) lines.push(resting);
  if (view.ending) {
    const commit = view.ending.commit ? `, commit ${view.ending.commit}` : '';
    lines.push(
      `ended: ${view.ending.status} by ${writerName(view.ending.writer, identity)}${commit}${view.ending.reason ? ` — ${view.ending.reason}` : ''}`,
    );
  }
  if (view.answeredBy !== null) lines.push(`answered by ${view.answeredBy}`);
  if (view.answeredCommit !== null) lines.push(`answered by commit ${view.answeredCommit}`);
  if (view.answeredCheck !== null)
    lines.push(`answered by a check at ${view.answeredCheck.head ?? 'an unborn HEAD'}: ${view.answeredCheck.finding}`);
  if (view.shape.blocks > 0) lines.push(`shape: ${shapeLine(view.shape)}`);
  const body = view.body.trim();
  if (body.length > 0) lines.push('', body);
  if (view.results) {
    lines.push('', 'Results');
    for (const name of view.results.missingScope) lines.push(`scope ${name} no longer stands`);
    for (const row of view.results.items) {
      lines.push(row.parentTitle === null ? blockLine(table, row) : `${blockLine(table, row)} · ${row.parentTitle}`);
    }
    lines.push(pageFooter(view.results.items.length, view.results.total));
  }
  if (view.children.length > 0) {
    lines.push('');
    const window = { left: options.outlineRows ?? Number.POSITIVE_INFINITY, cut: 0 };
    outline(table, view.name, view.children, 1, window, lines);
    if (window.cut > 0) lines.push(`… ${window.cut} more rows — narrow with depth, or read the zone whole with the zone read`);
  }
  return lines.join('\n');
}
