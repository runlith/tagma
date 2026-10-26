import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type Checkout, checkoutKey } from '../checkout.js';

const loaded = (path: string): Map<string, Checkout> => {
  const known = new Map<string, Checkout>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return known;
  }
  if (!Array.isArray(parsed)) return known;
  for (const one of parsed as unknown[]) {
    if (typeof one !== 'object' || one === null) continue;
    const { projectId, root } = one as { projectId?: unknown; root?: unknown };
    if (Number.isInteger(projectId) && typeof root === 'string') {
      const checkout = { projectId: projectId as number, root };
      known.set(checkoutKey(checkout), checkout);
    }
  }
  return known;
};

export const enforcingAt = (path: string | null) => {
  let known: Map<string, Checkout> | null = path === null ? new Map() : null;
  let dirty = false;
  const read = () => (known ??= loaded(path as string));
  const save = (): Effect.Effect<void, GateRefusal<'inspection-failed'>> => {
    if (path === null || !dirty) return Effect.void;
    return Effect.try(() => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.next`, `${JSON.stringify([...read().values()], null, 2)}\n`);
      renameSync(`${path}.next`, path);
      dirty = false;
    }).pipe(
      Effect.mapError(
        (error) =>
          new GateRefusal(
            'inspection-failed',
            `enforcement could not keep which checkouts to re-measure at ${path}: ${String(error.cause ?? error)}`,
            ['make the machine store writable and trigger re-measurement again'],
          ),
      ),
    );
  };
  return {
    all: (): readonly Checkout[] => [...read().values()],
    keep: (checkout: Checkout, enforcing: boolean) =>
      Effect.suspend(() => {
        const map = read();
        const key = checkoutKey(checkout);
        dirty ||= map.has(key) !== enforcing;
        if (enforcing) map.set(key, checkout);
        else map.delete(key);
        return save();
      }),
    forget: (checkouts: readonly Checkout[]) =>
      Effect.suspend(() => {
        for (const checkout of checkouts) dirty = read().delete(checkoutKey(checkout)) || dirty;
        return save();
      }),
  };
};
