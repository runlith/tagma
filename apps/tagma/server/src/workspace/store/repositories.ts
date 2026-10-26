import { and, eq, or } from 'drizzle-orm';
import { Data, Effect, Schema } from 'effect';
import { sameWitness } from '@runlith/files/witness';
import type { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { repository } from './tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { Repository, RepositoryId, RepositoryConflict, RepositoryUnavailable } from '../contract/wire/repositories.js';

export class RepositoryStorageFailed extends Data.TaggedError('RepositoryStorageFailed')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Repository store record ${this.key} cannot be read: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

const decodeRepository = Schema.decodeUnknownEffect(Repository);

const record = Effect.fn('RepositoryStore.record')(
  (row: typeof repository.$inferSelect) =>
    decodeRepository({
      repositoryId: row.repositoryId,
      namespaceId: row.namespaceId,
      commonDirectory: row.commonDirectory,
      locationRevision: row.locationRevision,
      witness: { provider: row.witnessProvider, format: row.witnessFormat, token: row.witnessToken },
      projectId: row.projectId,
      state: row.state,
    }),
  (work, row) => Effect.mapError(work, (cause) => new RepositoryStorageFailed({ key: row.repositoryId, cause })),
);

export type RepositoryStoreFailure = StoreFailure | RepositoryStorageFailed;

export const storageUnavailable = (
  namespaceId: NamespaceId,
  error: RepositoryStoreFailure,
  path?: string,
  repositoryId?: RepositoryId,
): RepositoryUnavailable => new RepositoryUnavailable({ namespaceId, path, repositoryId, reason: 'storage', message: error.message });

type Adoption = {
  readonly repository: Repository;
  readonly checked: readonly Repository[];
  readonly replaced: Repository | null;
};

export type RepositoryStore = Effect.Success<ReturnType<typeof makeRepositoryStore>>;

export const makeRepositoryStore = Effect.fnUntraced(function* ({ db }: { readonly db: StoreDb<'machine'> }) {
  const units = yield* MachineUnits;

  const byId = Effect.fn('RepositoryStore.byId')(function* (repositoryId: RepositoryId, tx?: Unit<'machine'>) {
    const query = db.select().from(repository).where(eq(repository.repositoryId, repositoryId)).get();
    const row = yield* tx ? tx.run(query) : query;
    return row ? yield* record(row) : null;
  });

  const candidates = Effect.fn('RepositoryStore.candidates')(function* (
    namespaceId: NamespaceId,
    commonDirectory: string,
    witness: IdentityWitness,
    tx?: Unit<'machine'>,
  ) {
    const query = db
      .select()
      .from(repository)
      .where(
        and(
          eq(repository.namespaceId, namespaceId),
          eq(repository.state, 'active'),
          or(
            eq(repository.commonDirectory, commonDirectory),
            and(
              eq(repository.witnessProvider, witness.provider),
              eq(repository.witnessFormat, witness.format),
              eq(repository.witnessToken, witness.token),
            ),
          ),
        ),
      )
      .all();
    return yield* Effect.forEach(yield* tx ? tx.run(query) : query, record);
  });

  const adopt = Effect.fn('RepositoryStore.adopt')((adoption: Adoption) =>
    units.write(
      writes('RepositoryStore.adopt', [repository]),
      Effect.fnUntraced(function* (unit) {
        const { repository: mine, checked, replaced } = adoption;
        const current = yield* candidates(mine.namespaceId, mine.commonDirectory, mine.witness, unit);
        const converged = current.find((row) => row.commonDirectory === mine.commonDirectory && sameWitness(row.witness, mine.witness));
        if (converged !== undefined) return converged;
        if (
          current.length !== checked.length ||
          current.some(
            (row) =>
              !checked.some(
                (previous) =>
                  row.repositoryId === previous.repositoryId &&
                  row.locationRevision === previous.locationRevision &&
                  row.commonDirectory === previous.commonDirectory,
              ),
          )
        ) {
          return yield* new RepositoryConflict({
            namespaceId: mine.namespaceId,
            path: mine.commonDirectory,
            reason: 'registry-changed',
            message: 'A registration candidate changed while this store was being resolved.',
          });
        }
        if (replaced !== null) yield* condemn(replaced, unit);
        yield* unit.run(db.insert(repository).values(values(mine)));
        return mine;
      }),
    ),
  );

  const condemn = Effect.fn('RepositoryStore.condemn')(function* (stale: Repository, unit: WriteUnit<'machine'>) {
    yield* unit.run(
      db
        .update(repository)
        .set({ state: 'replaced' })
        .where(
          and(
            eq(repository.repositoryId, stale.repositoryId),
            eq(repository.locationRevision, stale.locationRevision),
            eq(repository.state, 'active'),
          ),
        ),
    );
  });

  const relocate = Effect.fn('RepositoryStore.relocate')((moved: Repository, from: Repository) =>
    units.write(
      writes('RepositoryStore.relocate', [repository]),
      Effect.fnUntraced(function* (unit) {
        const claimants = (yield* candidates(moved.namespaceId, moved.commonDirectory, moved.witness, unit)).filter(
          (row) => row.repositoryId !== moved.repositoryId,
        );
        for (const claimant of claimants) yield* condemn(claimant, unit);
        const changed = yield* unit.run(
          db
            .update(repository)
            .set({ commonDirectory: moved.commonDirectory, locationRevision: moved.locationRevision })
            .where(
              and(
                eq(repository.repositoryId, from.repositoryId),
                eq(repository.locationRevision, from.locationRevision),
                eq(repository.state, 'active'),
              ),
            )
            .returning({ repositoryId: repository.repositoryId })
            .all(),
        );
        if (changed.length === 0) {
          return yield* new RepositoryConflict({
            namespaceId: moved.namespaceId,
            path: moved.commonDirectory,
            reason: 'registry-changed',
            message: 'This registration moved while its new address was being proved.',
          });
        }
        return moved;
      }),
    ),
  );

  function values(mine: Repository): typeof repository.$inferInsert {
    return {
      repositoryId: mine.repositoryId,
      namespaceId: mine.namespaceId,
      commonDirectory: mine.commonDirectory,
      locationRevision: mine.locationRevision,
      witnessProvider: mine.witness.provider,
      witnessFormat: mine.witness.format,
      witnessToken: mine.witness.token,
      projectId: mine.projectId,
      state: mine.state,
    };
  }

  return { byId, candidates, adopt, condemn, relocate };
});
