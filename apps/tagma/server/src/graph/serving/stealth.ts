import { Effect, type Semaphore } from 'effect';
import type { GateRefusal, OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { STEALTH_PREFIX } from '../contract/wire/storage.js';
import type {
  FreshnessGate,
  HeldGraph,
  MirrorBuilt,
  ServedGraph,
  StealthHold,
  StealthTree,
  TreeBatches,
} from '../contract/service/serving.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { type StorageLayout, stealthBeside } from '../storage/layout.js';
import { overRepositoryAndTree, overTree, type PermitHold } from './permits.js';

type Gate = FreshnessGate['Service'];

const flushedBatches = Effect.fnUntraced(function* (treeRoot: string, batches: TreeBatches | null) {
  if (batches === null) return;
  const flushed = yield* Effect.exit(batches.flush);
  if (flushed._tag === 'Failure') {
    yield* Effect.logWarning('a closing tree kept acts its last batch could not commit; its next open carries them', {
      tree: treeRoot,
      cause: flushed.cause,
    });
  }
});

export const heldFlush =
  (gates: (key: string) => Semaphore.Semaphore) =>
  (treeRoot: string, entry: HeldGraph): Effect.Effect<void> =>
    Effect.suspend(() => {
      const tree = entry.stealth?.tree() ?? null;
      return Effect.andThen(
        tree === null ? Effect.void : overRepositoryAndTree(gates, tree.layout)(flushedBatches(tree.layout.treeRoot, tree.batches)),
        flushedBatches(treeRoot, entry.batches),
      );
    });

export const closedTrees = (gate: Gate, treeRoot: string, served: ServedGraph): Effect.Effect<void> =>
  Effect.suspend(() => {
    const tree = served.stealth?.tree() ?? null;
    return Effect.andThen(tree === null ? Effect.void : gate.close(tree.layout.treeRoot), gate.close(treeRoot));
  });

export const actingTrees = (
  gates: (key: string) => Semaphore.Semaphore,
  gate: Gate,
  layout: StorageLayout,
  place: { readonly projectId: number; readonly appHome: string; readonly worktree: string },
): { readonly guard: PermitHold; readonly settled: Effect.Effect<void, GateRefusal<OpenRefusal>> } => {
  const own = overTree(gates, layout.treeRoot);
  if (layout.mode !== 'team') return { guard: own, settled: gate.beforeAct(layout.treeRoot) };
  const stealthRoot = stealthBeside(layout, place).treeRoot;
  const beside = overTree(gates, stealthRoot);
  return {
    guard: (act) => own(beside(act)),
    settled: Effect.andThen(gate.beforeAct(layout.treeRoot), gate.beforeAct(stealthRoot)),
  };
};

export const servedStealth = Effect.fnUntraced(function* (
  gate: Gate,
  place: { readonly checkout: string; readonly row: ProjectPolicyRow; readonly layout: StorageLayout; readonly built: MirrorBuilt },
) {
  const { checkout, row, layout, built } = place;
  const hold = built.stealth;
  const roots = { root: layout.treeRoot, stealth: hold?.root ?? null };
  const registration = yield* gate.register(layout.treeRoot, {
    checkout,
    row,
    layout,
    roots,
    prefix: '',
    shadow: built.shadow,
    poolContext: built.poolContext,
    ledger: built.ledger,
    batches: built.batches,
    topology: built.topology,
    scope: built.scope,
  });
  let hidden: { readonly unregister: () => void } | null = null;
  const watched = Effect.fnUntraced(function* (tree: StealthTree) {
    if (hidden !== null) return;
    hidden = yield* gate.register(tree.layout.treeRoot, {
      checkout,
      row,
      layout: tree.layout,
      roots,
      prefix: STEALTH_PREFIX,
      shadow: tree.shadow,
      poolContext: built.poolContext,
      ledger: built.ledger,
      batches: tree.batches,
      topology: tree.topology,
      scope: built.scope,
    });
    yield* gate.settled(tree.layout.treeRoot);
  });
  const standing = hold?.tree() ?? null;
  if (standing !== null) yield* watched(standing);
  const stealth: StealthHold | null = hold === null ? null : { root: hold.root, tree: hold.tree, attach: Effect.tap(hold.attach, watched) };
  const both = (each: (treeRoot: string) => Effect.Effect<void, GateRefusal<OpenRefusal>>) =>
    Effect.suspend(() => {
      const tree = hold?.tree() ?? null;
      return Effect.andThen(each(layout.treeRoot), tree === null ? Effect.void : each(tree.layout.treeRoot));
    });
  const unregister = () => {
    hidden?.unregister();
    registration.unregister();
  };
  return { stealth, both, unregister };
});
