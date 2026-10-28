import type { TagTable } from './table.js';
import type { Role, Tag } from './declaration.js';
import { lifecycleOf } from './lifecycle.js';

export type Tagged = {
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
};

export function hasTag(node: { readonly tags: readonly string[] }, id: string): boolean {
  return node.tags.includes(id);
}

export function fieldName(tag: Tag, role: Role): string | null {
  const bound = tag.roles[role];
  if (bound === undefined || bound === true) return null;
  return typeof bound === 'string' ? bound : bound.field;
}

export function tagLabel(tag: Tag | null): string {
  return tag === null ? 'an untagged node' : `#${tag.name ?? tag.id}`;
}

export function statusWords(tag: Tag): readonly string[] {
  const name = lifecycleOf(tag)?.field;
  const declared = name === undefined ? undefined : tag.fields[name];
  return declared !== undefined && typeof declared === 'object' && declared.type === 'enum' ? declared.values : [];
}

export function statusTargets(tag: Tag, from: string): string[] {
  const name = lifecycleOf(tag)?.field;
  return name === undefined
    ? []
    : tag.gates.flatMap((gate) => (gate.gate === 'transition' && gate.field === name && gate.from === from ? [gate.to] : []));
}

export function initialStatus(tag: Tag): string | null {
  return lifecycleOf(tag)?.initial ?? null;
}

export function terminalStatuses(tag: Tag): string[] {
  const binding = lifecycleOf(tag);
  return statusWords(tag).filter((word) => word === binding?.done || word === binding?.closed || statusTargets(tag, word).length === 0);
}

export function activeStatuses(tag: Tag): string[] {
  const born = initialStatus(tag);
  const ends = terminalStatuses(tag);
  return statusWords(tag).filter((word) => word !== born && !ends.includes(word));
}

export function claimedStatus(tag: Tag): string | null {
  return lifecycleOf(tag)?.claimed ?? null;
}

export function releasedStatus(tag: Tag): string | null {
  return initialStatus(tag);
}

export function endingStatus(tag: Tag, outcome: 'done' | 'closed'): string | null {
  const binding = lifecycleOf(tag);
  if (binding === null) return null;
  return (outcome === 'done' ? binding.done : binding.closed) ?? null;
}

export const STATUS_PHASES = ['initial', 'active', 'open', 'terminal'] as const;
export type StatusPhase = (typeof STATUS_PHASES)[number];

export function statusesAt(tag: Tag, phase: StatusPhase): string[] {
  const born = initialStatus(tag);
  const birth = born === null ? [] : [born];
  switch (phase) {
    case 'initial':
      return birth;
    case 'active':
      return activeStatuses(tag);
    case 'open':
      return [...birth, ...activeStatuses(tag)];
    case 'terminal':
      return terminalStatuses(tag);
  }
}

export type TagWords = {
  readonly tag: string;
  readonly name: string;
  readonly words: readonly string[];
};

export type StatusMove = {
  readonly tag: string;
  readonly field: string;
  readonly from: string | null;
  readonly to: string;
};

export function statusMove(tag: Tag, from: string | null, to: string): StatusMove | null {
  const field = lifecycleOf(tag)?.field;
  return field === undefined ? null : { tag: tag.id, field, from, to };
}
