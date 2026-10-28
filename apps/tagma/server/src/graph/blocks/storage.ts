import { Clock, Effect } from 'effect';
import { inArray } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StorageMode } from '../../projects/contract/wire/project.js';
import { Act, type BlockWrite } from '../contract/service/acts.js';
import type { SetStorageRefusal } from '../contract/service/blocks.js';
import { ServedStorage } from '../contract/service/serving.js';
import { blockName } from '../contract/wire/references.js';
import { BlockRows } from '../acts/rows.js';
import { block } from '../store/tables.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting } from '../store/actWrites.js';

const storing = writes('Blocks.setStorage', [block], projecting);

const ready = Effect.fn('Blocks.stealthReady')(function* () {
  const storage = yield* ServedStorage;
  if (storage?.mode === 'stealth') {
    return yield* new GateRefusal(
      'storage-unavailable',
      'this project keeps its whole graph stealth, so no block of it rides the repository',
      ['set_project_storage team, naming the subtrees that stay stealth — the project then rides the repository'],
    );
  }
  if (storage === null || storage.stealth === null) {
    return yield* new GateRefusal(
      'storage-unavailable',
      'this copy of the graph keeps no stealth tree, so it cannot hold a stealth block',
      ['act from a checkout that stands on a branch — its copy keeps the stealth tree beside .tagma'],
    );
  }
  return storage.stealth;
});

export const attachedStealth = Effect.fn('Blocks.attachStealth')(function* () {
  const hold = yield* ready();
  yield* Effect.mapError(
    hold.attach,
    (refused) => new GateRefusal('storage-unavailable', `the stealth tree could not be attached: ${refused.reason}`, refused.unblock),
  );
});

export const blockStorage = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockRows = yield* BlockRows;

  const setStorage = Effect.fn('Blocks.setStorage')(function* (input: {
    readonly id: number;
    readonly storage: StorageMode;
  }): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<SetStorageRefusal>> {
    const current = yield* blockRows.blockById(input.id);
    const name = blockName(current.uuid);
    const stealth = input.storage === 'stealth';
    yield* ready();
    if (current.parentId === null) {
      return yield* new GateRefusal('project-root', `${name} is the project root, whose storage is the project's`, [
        'set_project_storage — the root moves with the whole project',
      ]);
    }
    if (current.stealth === stealth) {
      return yield* new GateRefusal('storage-unchanged', `${name} is already ${input.storage}`, ['nothing to move']);
    }
    const parent = yield* blockRows.blockById(current.parentId);
    if (!stealth && parent.stealth) {
      return yield* new GateRefusal(
        'stealth-dependency',
        `${name} stands under stealth block ${blockName(parent.uuid)}, so it stays stealth`,
        [
          `set_block_storage ${blockName(parent.uuid)} team — the parent goes first`,
          `update_block ${name} with a team parent, then set its storage`,
        ],
      );
    }
    if (stealth) yield* attachedStealth();
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      storing,
      Effect.gen(function* () {
        const subtree = [input.id, ...(yield* blockRows.collectDescendants(input.id)).map((row) => row.id)];
        yield* db.update(block).set({ stealth, updatedAt: now }).where(inArray(block.id, subtree));
        const row = yield* blockRows.blockById(input.id);
        yield* act.record('update', row.id, { storage: input.storage, blocks: subtree.length }, now);
        return yield* blockRows.written(row, false);
      }),
    );
  });

  return { setStorage };
});
