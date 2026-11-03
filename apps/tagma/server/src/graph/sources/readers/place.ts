import { Effect } from 'effect';
import { type SQL, sql } from 'drizzle-orm';
import { block, source } from '../../store/tables.js';
import { SOURCE_KINDS, type SourceKind } from '../../contract/wire/sources.js';
import { likeLiteral } from '../../acts/rows.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Tag } from '../../contract/wire/tags/declaration.js';
import type { TagReading } from '../../contract/wire/tags/reading.js';

export type SourceTarget = {
  kind: SourceKind;
  ref: string;
  symbol: string | null;
};

export function sourcePath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed.startsWith('/')) return null;
  const parts = trimmed.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) return null;
  return parts.length === 0 ? '.' : parts.join('/');
}

export function insideRelative(path: string, root: string): boolean {
  return root === '.' || path === root || path.startsWith(`${root}/`);
}

export function depthOf(territory: string): number {
  return territory === '.' ? 0 : territory.length;
}

export function insideAny(path: string, roots: ReadonlySet<string>): boolean {
  if (roots.has('.') || roots.has(path)) return true;
  for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
    if (roots.has(path.slice(0, cut))) return true;
  }
  return false;
}

export function placeKey(source: SourceTarget): string {
  return JSON.stringify([source.kind === 'dir', source.ref, source.kind === 'dir' ? null : source.symbol]);
}

export const sourcePathsCondition = Effect.fnUntraced(function* (paths: readonly string[]) {
  const inside: SQL[] = [];
  for (const raw of paths) {
    const place = sourcePath(raw);
    if (place === null) {
      return yield* new GateRefusal('source-outside', `"${raw}" is not a place inside the project`, [
        'name a path relative to the project root, without a leading "/" or ".."',
      ]);
    }
    inside.push(place === '.' ? sql`1` : sql`(s.ref = ${place} or s.ref like ${`${likeLiteral(place)}/%`} escape '\\')`);
  }
  return sql`exists (select 1 from ${source} s where s.block_id = ${block.id} and (${sql.join(inside, sql` or `)}))`;
});

export function sourceKinds(table: TagReading, node: { readonly tags: readonly string[] }): readonly SourceKind[] {
  return node.tags.length === 0 ? SOURCE_KINDS : [...new Set(table.tagsOf(node).flatMap((tag) => tag.sources ?? []))];
}

export function assertRequiredSources(
  tags: readonly Tag[],
  sources: readonly { readonly kind: SourceKind }[],
  way: string,
): Effect.Effect<void, GateRefusal<'source-required'>> {
  for (const tag of tags) {
    for (const gate of tag.gates) {
      if (gate.gate !== 'source-required' || sources.some((source) => gate.kinds.includes(source.kind))) continue;
      const wanted = gate.kinds.map((kind) => `a ${kind}`).join(' or ');
      return new GateRefusal('source-required', `${tag.id}.source-required: a #${tag.id} stands over ${wanted}`, [way]);
    }
  }
  return Effect.void;
}
