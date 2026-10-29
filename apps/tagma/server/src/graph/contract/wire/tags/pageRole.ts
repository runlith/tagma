import type { ContractId } from './behaviour.js';
import type { TagReading } from './reading.js';
import { CONTAINER } from './container.js';
import { LAW } from './lawContracts.js';
import { SPEC } from './spec.js';
import { WORK } from './work.js';
import { OBSERVATION } from './observation.js';
import { LEAF } from './leaf.js';

const BOUND: readonly (readonly [PageRole, ContractId])[] = [
  ['container', CONTAINER],
  ['law', LAW],
  ['spec', SPEC],
  ['work', WORK],
  ['observation', OBSERVATION],
  ['leaf', LEAF],
];

export const PAGE_ROLES = ['container', 'law', 'spec', 'work', 'observation', 'leaf', 'knowledge'] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

export const SCREEN_ROWS = 20;

export function pageRoleOf(table: TagReading, node: { readonly tags: readonly string[] }): PageRole {
  for (const [role, contract] of BOUND) if (table.supports(node, contract)) return role;
  return 'knowledge';
}
