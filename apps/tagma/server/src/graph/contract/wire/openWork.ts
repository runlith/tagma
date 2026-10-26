import type { TagWords } from './tags/roles.js';

const quoted = (text: string): string => `'${text.replaceAll("'", "''")}'`;

function wordsIn(sets: readonly TagWords[], blockId: string): string {
  const carried = sets.filter((set) => set.words.length > 0);
  if (carried.length === 0) return '0';
  return `(${carried
    .map(
      (set) =>
        `exists (select 1 from block_field f where f.block_id = ${blockId} and f.tag = ${quoted(set.tag)} and f.name = ${quoted(set.name)} and f.value in (${set.words.map(quoted).join(', ')}))`,
    )
    .join(' or ')})`;
}

export type OpenWork = {
  readonly open: readonly TagWords[];
  readonly kinds: readonly string[];
};

export function openWork({ open, kinds }: OpenWork) {
  const kindList = kinds.length === 0 ? '(null)' : `(${kinds.map(quoted).join(', ')})`;
  return {
    below: (seed: string) =>
      `below(root, id) as (select id, id from (${seed}) union select below.root, b.id from block b join below on b.parent_id = below.id where b.deleted_at is null)`,
    hasOpenWork: (spec: string) =>
      `exists (select 1 from (select id from below where root = ${spec} union select e.from_id from edge e where e.to_id = ${spec} and e.kind in ${kindList}) w join block t on t.id = w.id where t.deleted_at is null and ${wordsIn(open, 't.id')} and not exists (select 1 from edge x where x.kind = 'supersedes' and x.to_id = t.id))`,
  };
}
