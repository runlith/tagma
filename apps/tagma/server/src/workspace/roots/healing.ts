import { Cause, Effect } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { fileRoot, fileRootNamespace } from '../store/tables.js';
import type { RootId } from '../contract/wire/ids.js';
import type { RootResolutionFailure } from '../contract/wire/roots.js';
import type { RootUseFailure } from '../contract/wire/uses.js';
import { FileRoots, RootHoldings, RootUses } from '../contract/service/roots.js';
import type { FileRootStore, RootStoreFailure } from '../store/rootRegistry.js';

export type RootHealing = Effect.Success<ReturnType<typeof makeRootHealing>>;

export const makeRootHealing = Effect.fnUntraced(function* ({ records }: { readonly records: FileRootStore }) {
  const roots = yield* FileRoots;
  const uses = yield* RootUses;
  const units = yield* MachineUnits;
  const holdings = yield* RootHoldings;

  const pass = Effect.fn('roots.pass')(function* (): Effect.fn.Return<readonly RootId[], RootUseFailure | RootStoreFailure> {
    const gone = yield* scan();
    if (gone.length === 0) return [];
    const held = yield* units.read((unit) => uses.holding(unit, gone));
    const fenced = new Set<RootId>();
    for (const use of held) for (const binding of use.roots) fenced.add(binding.rootId);
    const retired: RootId[] = [];
    for (const rootId of gone) {
      if (fenced.has(rootId)) continue;
      const healed = yield* retireIfGone(rootId);
      if (healed !== null) retired.push(healed);
    }
    return retired;
  });

  const scan = Effect.fn('roots.scan')(function* (): Effect.fn.Return<readonly RootId[], RootStoreFailure | RootResolutionFailure> {
    const gone: RootId[] = [];
    let after: RootId | undefined;
    while (true) {
      const page = yield* records.page(roots.namespaceId, after);
      if (page.length === 0) break;
      for (const root of page) {
        after = root.rootId;
        const seen = yield* roots.probe(root.path).pipe(Effect.catchTag('RootMissing', () => Effect.succeed(null)));
        if (seen === null) gone.push(root.rootId);
      }
    }
    return gone;
  });

  function retireIfGone(rootId: RootId): Effect.Effect<RootId | null, RootUseFailure | RootStoreFailure> {
    return units.write(writes('RootHealing.retireIfGone', [fileRoot, fileRootNamespace]), (unit) =>
      Effect.gen(function* () {
        const held = yield* uses.holding(unit, [rootId]);
        if (held.length > 0 || (yield* holdings.has(unit, rootId))) return null;
        return yield* roots.retireMissing(rootId, unit).pipe(
          Effect.as(rootId),
          Effect.catchTag(['RootConflict', 'RootMissing'], () => Effect.succeed(null)),
        );
      }),
    );
  }

  return { pass };
});

const HEALING_INTERVAL_MS = 24 * 60 * 60_000;

export const healRootsDaily = (healing: RootHealing): Effect.Effect<never> =>
  Effect.forever(
    healing.pass().pipe(
      Effect.tap((retired) => (retired.length === 0 ? Effect.void : Effect.logInfo('dead root registrations retired', { roots: retired }))),
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.logWarning('root registry healing could not run', { reason: Cause.squash(cause) })),
      Effect.andThen(Effect.sleep(HEALING_INTERVAL_MS)),
    ),
  );
