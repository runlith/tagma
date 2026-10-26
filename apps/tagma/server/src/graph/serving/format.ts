import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import type { FormatHold } from '../contract/service/serving.js';
import { FORMAT_FILE, VOCABULARY_FORMAT_KEY } from '../contract/wire/storage.js';
import { VOCABULARY_FORMAT } from '../contract/wire/tags/revision.js';
import { meta } from '../store/tables.js';
import { markerStep, readMarker, type TreeMarker, writeMarker } from '../tree/marker.js';
import type { GraphSteps } from '../contract/service/steps.js';

const stamping = writes('VocabularyFormat.stamp', [meta]);

type Held = { readonly code: 'vocabulary-newer' | 'vocabulary-older' | 'graph-pool'; readonly reason: string; readonly unblock: Unblock };

const SERVED = 'it serves reads and refuses writes and catalog installs';

const UPGRADE: Unblock = ['run a Tagma release that understands this format; until then every read here still answers'];

class ServedFormat implements FormatHold {
  private stepReached: string | null;

  constructor(
    private readonly path: string,
    private readonly stored: string | null,
    private tree: TreeMarker,
    private readonly steps: GraphSteps['Service'],
  ) {
    this.stepReached = markerStep(tree);
  }

  private older(step: string | null): Held | null {
    const base = this.steps.base;
    if (base === null || this.steps.standing(step) !== 'older') return null;
    return {
      code: 'vocabulary-older',
      reason: `${this.path} ${step === null ? 'carries no graph step' : `was brought to graph step "${step}"`}, older than "${base.step}", the oldest form this server brings forward: ${SERVED}`,
      unblock: [`open this project once with Tagma ${base.release}, which brings its graph to "${base.step}"; then this release opens it`],
    };
  }

  private held(): Held | null {
    if (this.stored !== null) {
      const stored = Number(this.stored);
      if (!Number.isSafeInteger(stored)) {
        return {
          code: 'graph-pool',
          reason: `this checkout's graph store carries vocabulary format "${this.stored}", which is no format number, so this server cannot tell whether it is newer than format ${VOCABULARY_FORMAT}: ${SERVED}`,
          unblock: ['the graph store is a mirror its tree rebuilds: remove the mirror file, then open the project again'],
        };
      }
      if (stored > VOCABULARY_FORMAT) {
        return {
          code: 'vocabulary-newer',
          reason: `this checkout's graph store carries vocabulary format ${stored}, and this server understands format ${VOCABULARY_FORMAT}: ${SERVED}`,
          unblock: UPGRADE,
        };
      }
    }
    switch (this.tree.kind) {
      case 'absent':
        return this.older(null);
      case 'read':
        return this.steps.standing(this.tree.step) === 'newer'
          ? {
              code: 'vocabulary-newer',
              reason: `${this.path} was brought to graph step "${this.tree.step}", which this server does not know: ${SERVED}`,
              unblock: UPGRADE,
            }
          : this.older(this.tree.step);
      case 'unreadable':
        return {
          code: 'graph-pool',
          reason: `${this.path} does not read as a format marker (${this.tree.reason}), so this server cannot tell whether the tree is newer than it: ${SERVED}`,
          unblock: [`restore ${FORMAT_FILE} from the tree's git history, then read the graph again`],
        };
      case 'unwritten':
        return {
          code: 'graph-pool',
          reason: `${this.path} could not be written (${this.tree.reason}), so the tree carries no format marker: ${SERVED}`,
          unblock: [`make ${this.path} writable, then open the graph again`],
        };
    }
  }

  readonly writable: FormatHold['writable'] = Effect.suspend(() => {
    const held = this.held();
    return held === null ? Effect.void : Effect.fail(new GateRefusal(held.code, held.reason, held.unblock));
  });

  holds(): boolean {
    return this.held() !== null;
  }

  reached(): string | null {
    return this.stepReached;
  }

  reach(): void {
    this.stepReached = this.steps.last;
  }

  readonly read: FormatHold['read'] = Effect.flatMap(
    Effect.suspend(() => readMarker(this.path)),
    (tree) =>
      Effect.sync(() => {
        this.tree = tree;
        this.stepReached = markerStep(tree);
      }),
  );

  readonly stamp: FormatHold['stamp'] = Effect.suspend(() => {
    const last = this.steps.last;
    if (this.holds() || this.steps.after(this.stepReached).length > 0) return Effect.succeed(false);
    if (this.tree.kind === 'read' && this.tree.step === last) return Effect.succeed(false);
    return Effect.flatMap(Effect.result(writeMarker(this.path, last)), (wrote) => {
      if (wrote._tag === 'Success') {
        this.tree = { kind: 'read', step: last };
        return Effect.succeed(true);
      }
      this.tree = { kind: 'unwritten', reason: wrote.failure.message };
      return Effect.fail(
        new GateRefusal('graph-pool', `${this.path} could not be written (${wrote.failure.message}): ${SERVED}`, [
          `make ${this.path} writable, then open the graph again`,
        ]),
      );
    });
  });
}

export const openFormat = Effect.fn('VocabularyFormat.open')(function* (
  treeRoot: string,
  steps: GraphSteps['Service'],
): Effect.fn.Return<ServedFormat, StoreFailure, GraphStore> {
  const store = yield* GraphStore;
  const row = yield* store.db.select().from(meta).where(eq(meta.key, VOCABULARY_FORMAT_KEY)).get();
  const path = join(treeRoot, FORMAT_FILE);
  const hold = new ServedFormat(path, row?.value ?? null, yield* readMarker(path), steps);
  if (hold.holds() || row?.value === String(VOCABULARY_FORMAT)) return hold;
  const value = String(VOCABULARY_FORMAT);
  yield* store.transaction(stamping, () =>
    store.db.insert(meta).values({ key: VOCABULARY_FORMAT_KEY, value }).onConflictDoUpdate({ target: meta.key, set: { value } }),
  );
  return hold;
});
