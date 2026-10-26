import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export const duplicateIdentity = (paths: readonly string[]) =>
  new GateRefusal('duplicate-identity', `two block files carry one identity: ${paths.join(', ')}`, [
    'a copied block file is a NEW block: mint it a fresh id, or delete the copy',
  ]);

export function twiceHeld(entries: readonly { readonly path: string; readonly id: string }[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) twice.add(entry.id);
    seen.add(entry.id);
  }
  return entries.filter((entry) => twice.has(entry.id)).map((entry) => entry.path);
}
