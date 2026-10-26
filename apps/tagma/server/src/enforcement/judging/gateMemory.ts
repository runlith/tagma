import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Context, Effect } from 'effect';
import { enforcedStatutes, type Statute } from '../rules/reach.js';

export class GateMemory extends Context.Service<
  GateMemory,
  {
    gated(projectId: number): Effect.Effect<boolean>;
    remember(projectId: number, gated: boolean): Effect.Effect<void>;
  }
>()('tagma/enforcement/GateMemory') {}

export const gatedIn = (enforced: readonly Pick<Statute, 'document'>[]): boolean =>
  enforced.some(
    (entry) => entry.document === null || (entry.document.strictness === 'gate' && entry.document.on.some((one) => one.phase === 'before')),
  );

export const rememberGating = Effect.fn('enforcement.rememberGating')(function* (projectId: number) {
  const memory = yield* GateMemory;
  const governed = yield* Effect.result(enforcedStatutes(projectId));
  if (governed._tag === 'Success') yield* memory.remember(projectId, gatedIn(governed.success));
  else yield* Effect.logWarning(`enforcement could not read which rules gate project ${projectId}: ${governed.failure.message}`);
});

const loaded = (path: string): Map<number, boolean> => {
  const known = new Map<number, boolean>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return known;
  }
  if (typeof parsed !== 'object' || parsed === null) return known;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const projectId = Number(key);
    if (Number.isInteger(projectId) && typeof value === 'boolean') known.set(projectId, value);
  }
  return known;
};

export const gateMemoryAt = (path: string | null): GateMemory['Service'] => {
  let known: Map<number, boolean> | null = path === null ? new Map() : null;
  const read = () => (known ??= loaded(path as string));
  return {
    gated: (projectId) => Effect.sync(() => read().get(projectId) === true),
    remember: (projectId, gated) =>
      Effect.suspend(() => {
        const map = read();
        if (map.get(projectId) === gated) return Effect.void;
        map.set(projectId, gated);
        if (path === null) return Effect.void;
        return Effect.try(() => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(`${path}.next`, `${JSON.stringify(Object.fromEntries(map), null, 2)}\n`);
          renameSync(`${path}.next`, path);
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning(`enforcement could not keep which projects gate at ${path}: ${String(error.cause ?? error)}`),
          ),
        );
      }),
  };
};
