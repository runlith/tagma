import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { Data, Effect, Schema } from 'effect';
import type { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { sameWitness } from '@runlith/files/witness';
import { pagesOf } from '../../platform/store/binds.js';
import { fileRoot, fileRootNamespace } from './tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { RootAdoption } from '../contract/service/roots.js';
import { RootId } from '../contract/wire/ids.js';
import { FileRoot, RootFootprint, RootGit, RootConflict, RootProvenance, RootRefused, RootUnavailable } from '../contract/wire/roots.js';

export class RootStorageFailed extends Data.TaggedError('RootStorageFailed')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Root store record ${this.key} cannot be read: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

const registering = writes('FileRootStore.register', [fileRoot, fileRootNamespace]);

const decodeRevision = Schema.decodeUnknownEffect(RootFootprint.fields.registryRevision);
const StoredRoot = Schema.Struct({
  ...FileRoot.fields,
  provenance: Schema.fromJsonString(RootProvenance),
});
const decodeRoot = Schema.decodeUnknownEffect(StoredRoot);
const decodeRoots = Schema.decodeUnknownEffect(Schema.Array(StoredRoot));

const rootFields = (row: typeof fileRoot.$inferSelect) => ({
  rootId: row.rootId,
  namespaceId: row.namespaceId,
  path: row.path,
  locationRevision: row.locationRevision,
  state: row.state,
  witness: { provider: row.witnessProvider, format: row.witnessFormat, token: row.witnessToken },
  provenance: row.provenance,
  git:
    row.repositoryId === null || row.gitDirectory === null
      ? null
      : { repositoryId: row.repositoryId, gitDirectory: { namespaceId: row.namespaceId, path: row.gitDirectory } },
});

const record = (row: typeof fileRoot.$inferSelect) =>
  decodeRoot(rootFields(row)).pipe(Effect.mapError((cause) => new RootStorageFailed({ key: row.rootId, cause })));

export type RootStoreFailure = StoreFailure | RootStorageFailed;

export const storageUnavailable = (namespaceId: NamespaceId, error: RootStoreFailure, path?: string, rootId?: RootId): RootUnavailable =>
  new RootUnavailable({ namespaceId, path, rootId, reason: 'storage', message: error.message });

const pageSize = 64;

const linked = (row: FileRoot, facet: RootGit | null | undefined): boolean =>
  facet === undefined ||
  ((facet?.repositoryId ?? null) === (row.git?.repositoryId ?? null) &&
    (facet === null ? null : facet.gitDirectory.path) === (row.git === null ? null : row.git.gitDirectory.path));

export type FileRootStore = Effect.Success<ReturnType<typeof makeFileRootStore>>;

export const makeFileRootStore = Effect.fnUntraced(function* ({ db }: { readonly db: StoreDb<'machine'> }) {
  const units = yield* MachineUnits;

  const revision = Effect.fn('FileRootStore.revision')(function* (namespaceId: NamespaceId, tx?: Unit<'machine'>) {
    const query = db.select().from(fileRootNamespace).where(eq(fileRootNamespace.namespaceId, namespaceId)).get();
    const row = yield* tx ? tx.run(query) : query;
    return row === undefined
      ? 0
      : yield* decodeRevision(row.revision).pipe(Effect.mapError((cause) => new RootStorageFailed({ key: namespaceId, cause })));
  });

  const byId = Effect.fn('FileRootStore.byId')(function* (rootId: RootId, tx?: Unit<'machine'>) {
    const query = db.select().from(fileRoot).where(eq(fileRoot.rootId, rootId)).get();
    const row = yield* tx ? tx.run(query) : query;
    return row ? yield* record(row) : null;
  });

  const active = Effect.fn('FileRootStore.active')(function* (namespaceId: NamespaceId) {
    const rows = yield* db
      .select()
      .from(fileRoot)
      .where(and(eq(fileRoot.namespaceId, namespaceId), eq(fileRoot.state, 'active')))
      .orderBy(asc(fileRoot.rootId))
      .all();
    return yield* decodeRoots(rows.map(rootFields)).pipe(Effect.mapError((cause) => new RootStorageFailed({ key: namespaceId, cause })));
  });

  const changesSince = Effect.fn('FileRootStore.changesSince')(function* (namespaceId: NamespaceId, since: number) {
    const rows = yield* db
      .select({ revision: fileRootNamespace.revision, root: fileRoot })
      .from(fileRootNamespace)
      .leftJoin(fileRoot, and(eq(fileRoot.namespaceId, fileRootNamespace.namespaceId), gt(fileRoot.changedRevision, since)))
      .where(eq(fileRootNamespace.namespaceId, namespaceId))
      .all();
    const revision = yield* decodeRevision(rows[0]?.revision ?? 0).pipe(
      Effect.mapError((cause) => new RootStorageFailed({ key: namespaceId, cause })),
    );
    const roots = yield* decodeRoots(rows.flatMap(({ root }) => (root === null ? [] : [rootFields(root)]))).pipe(
      Effect.mapError((cause) => new RootStorageFailed({ key: namespaceId, cause })),
    );
    return { revision, roots };
  });

  const page = Effect.fn('FileRootStore.page')(function* (namespaceId: NamespaceId, after?: RootId) {
    const rows = yield* db
      .select()
      .from(fileRoot)
      .where(
        and(
          eq(fileRoot.namespaceId, namespaceId),
          eq(fileRoot.state, 'active'),
          after === undefined ? undefined : gt(fileRoot.rootId, after),
        ),
      )
      .orderBy(asc(fileRoot.rootId))
      .limit(pageSize)
      .all();
    return yield* Effect.forEach(rows, record);
  });

  const identities = Effect.fn('FileRootStore.identities')(function* (
    namespaceId: NamespaceId,
    witnesses: readonly IdentityWitness[],
    tx: Unit<'machine'>,
  ) {
    if (witnesses.length === 0) return [];
    const rows = yield* tx.run(
      db.all<{
        root_id: string;
      }>(sql`
      select root_id from ${fileRoot}
      where (${fileRoot.namespaceId}, ${fileRoot.witnessProvider}, ${fileRoot.witnessFormat}, ${fileRoot.witnessToken})
      in (values ${sql.join(
        witnesses.map((witness) => sql`(${namespaceId}, ${witness.provider}, ${witness.format}, ${witness.token})`),
        sql`, `,
      )})
    `),
    );
    return rows.map((row) => RootId.make(row.root_id));
  });

  const byIds = Effect.fn('FileRootStore.byIds')(function* (rootIds: readonly RootId[], tx?: Unit<'machine'>) {
    if (rootIds.length === 0) return [];
    const query = db.select().from(fileRoot).where(inArray(fileRoot.rootId, rootIds)).all();
    return yield* Effect.forEach(yield* tx ? tx.run(query) : query, record);
  });

  const candidates = Effect.fn('FileRootStore.candidates')(function* (
    namespaceId: NamespaceId,
    path: string,
    witness: IdentityWitness,
    tx?: Unit<'machine'>,
  ) {
    const active = sql`${fileRoot.state} = 'active'`;
    const query = db
      .select()
      .from(fileRoot)
      .where(and(eq(fileRoot.namespaceId, namespaceId), active, eq(fileRoot.path, path)))
      .union(
        db
          .select()
          .from(fileRoot)
          .where(
            and(
              eq(fileRoot.namespaceId, namespaceId),
              active,
              eq(fileRoot.witnessProvider, witness.provider),
              eq(fileRoot.witnessFormat, witness.format),
              eq(fileRoot.witnessToken, witness.token),
            ),
          ),
      )
      .all();
    const rows = yield* tx ? tx.run(query) : query;
    return yield* Effect.forEach(rows, record);
  });

  const write = <A, E>(work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, E>): Effect.Effect<A, E | StoreFailure> =>
    units.write(registering, work);

  const settle = Effect.fn('FileRootStore.settle')((adoption: RootAdoption, unit: WriteUnit<'machine'>) =>
    Effect.gen(function* () {
      const { root, facet, checked, replaced, duplicate } = adoption;
      const current = yield* candidates(root.namespaceId, root.path, root.witness, unit);
      if (
        current.length !== checked.length ||
        current.some(
          (row) => !checked.some((previous) => row.rootId === previous.rootId && row.locationRevision === previous.locationRevision),
        )
      ) {
        return yield* new RootConflict({
          namespaceId: root.namespaceId,
          path: root.path,
          reason: 'registry-changed',
          message: 'A registration candidate changed during filesystem resolution.',
        });
      }
      if (adoption.moved !== null) {
        if (replaced.length > 0) {
          const revision = yield* bump(root, unit);
          yield* unit.run(
            db
              .update(fileRoot)
              .set({ state: 'replaced', changedRevision: revision })
              .where(
                inArray(
                  fileRoot.rootId,
                  replaced.map((one) => one.rootId),
                ),
              ),
          );
        }
        yield* relocate(root, unit);
        return yield* relink(root, facet, unit);
      }
      if (duplicate !== null && replaced.length === 0) return yield* relink(duplicate, facet, unit);
      const revision = yield* bump(root, unit);
      for (const previous of replaced) {
        yield* unit.run(
          db.update(fileRoot).set({ state: 'replaced', changedRevision: revision }).where(eq(fileRoot.rootId, previous.rootId)),
        );
      }
      if (duplicate !== null) return yield* relink(duplicate, facet, unit);
      yield* unit.run(
        db.insert(fileRoot).values({
          rootId: root.rootId,
          namespaceId: root.namespaceId,
          path: root.path,
          locationRevision: root.locationRevision,
          changedRevision: revision,
          witnessProvider: root.witness.provider,
          witnessFormat: root.witness.format,
          witnessToken: root.witness.token,
          provenance: JSON.stringify(root.provenance),
          repositoryId: root.git?.repositoryId ?? null,
          gitDirectory: root.git?.gitDirectory.path ?? null,
          state: root.state,
        }),
      );
      return root;
    }),
  );

  const settleAll = Effect.fn('FileRootStore.settleAll')(function* (
    adoptions: readonly RootAdoption[],
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<readonly FileRoot[], RootStoreFailure | RootConflict | RootRefused> {
    const first = adoptions[0];
    if (first === undefined) return [];
    const namespaceId = first.root.namespaceId;
    const standing = new Map<string, FileRoot>();
    for (const page of pagesOf(adoptions, 2, (adoption) => adoption.root.path.length + adoption.root.witness.token.length)) {
      const rows = yield* unit.run(
        db
          .select()
          .from(fileRoot)
          .where(
            and(
              eq(fileRoot.namespaceId, namespaceId),
              eq(fileRoot.state, 'active'),
              or(
                inArray(
                  fileRoot.path,
                  page.map((adoption) => adoption.root.path),
                ),
                inArray(
                  fileRoot.witnessToken,
                  page.map((adoption) => adoption.root.witness.token),
                ),
              ),
            ),
          )
          .all(),
      );
      for (const row of rows) standing.set(row.rootId, yield* record(row));
    }
    const byPath = new Map<string, FileRoot[]>();
    const byToken = new Map<string, FileRoot[]>();
    for (const row of standing.values()) {
      byPath.set(row.path, [...(byPath.get(row.path) ?? []), row]);
      byToken.set(row.witness.token, [...(byToken.get(row.witness.token) ?? []), row]);
    }
    const settled: FileRoot[] = [];
    const fresh = new Set<number>();
    const moving = new Set<number>();
    for (const adoption of adoptions) {
      const { root, checked, duplicate, replaced, moved, facet } = adoption;
      const near = [...(byPath.get(root.path) ?? []), ...(byToken.get(root.witness.token) ?? [])];
      const current = [
        ...new Map(
          near.filter((row) => row.path === root.path || sameWitness(row.witness, root.witness)).map((row) => [row.rootId, row]),
        ).values(),
      ];
      if (
        current.length !== checked.length ||
        current.some(
          (row) => !checked.some((previous) => row.rootId === previous.rootId && row.locationRevision === previous.locationRevision),
        )
      ) {
        return yield* new RootConflict({
          namespaceId,
          path: root.path,
          reason: 'registry-changed',
          message: 'A registration candidate changed during filesystem resolution.',
        });
      }
      const plain = moved === null && replaced.length === 0;
      if (plain && duplicate === null) fresh.add(settled.length);
      else if (!(plain && duplicate !== null && linked(duplicate, facet))) moving.add(settled.length);
      settled.push(plain && duplicate !== null ? duplicate : root);
    }
    for (const index of moving) settled[index] = yield* settle(adoptions[index]!, unit);
    if (fresh.size === 0) return settled;
    const revision = yield* bump(first.root, unit);
    const rows = [...fresh].map((index) => {
      const root = settled[index]!;
      return {
        rootId: root.rootId,
        namespaceId: root.namespaceId,
        path: root.path,
        locationRevision: root.locationRevision,
        changedRevision: revision,
        witnessProvider: root.witness.provider,
        witnessFormat: root.witness.format,
        witnessToken: root.witness.token,
        provenance: JSON.stringify(root.provenance),
        repositoryId: root.git?.repositoryId ?? null,
        gitDirectory: root.git?.gitDirectory.path ?? null,
        state: root.state,
      };
    });
    for (const page of pagesOf(rows, 12, (row) => row.path.length + row.provenance.length + (row.gitDirectory?.length ?? 0))) {
      yield* unit.run(db.insert(fileRoot).values(page));
    }
    return settled;
  });

  const replaced = Effect.fn('FileRootStore.replaced')(function* (root: FileRoot) {
    yield* units.write(writes('FileRootStore.replaced', [fileRoot, fileRootNamespace]), (unit) => condemn(root, unit));
  });

  const relink = Effect.fn('FileRootStore.relink')(function* (
    row: FileRoot,
    facet: RootGit | null | undefined,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<FileRoot, RootStoreFailure | RootRefused> {
    if (linked(row, facet)) return row;
    const stated = facet === null || facet === undefined ? null : facet.gitDirectory.path;
    const revision = yield* bump(row, unit);
    yield* unit.run(
      db
        .update(fileRoot)
        .set({ repositoryId: facet?.repositoryId ?? null, gitDirectory: stated, changedRevision: revision })
        .where(and(eq(fileRoot.rootId, row.rootId), eq(fileRoot.locationRevision, row.locationRevision), eq(fileRoot.state, 'active'))),
    );
    return { ...row, git: facet ?? null };
  });

  const condemn = Effect.fn('FileRootStore.condemn')(function* (root: FileRoot, unit: WriteUnit<'machine'>) {
    const changed = yield* unit.run(
      db
        .update(fileRoot)
        .set({
          state: 'replaced',
          changedRevision: sql`(select ${fileRootNamespace.revision} + 1 from ${fileRootNamespace} where ${fileRootNamespace.namespaceId} = ${root.namespaceId})`,
        })
        .where(and(eq(fileRoot.rootId, root.rootId), eq(fileRoot.locationRevision, root.locationRevision), eq(fileRoot.state, 'active')))
        .returning({ rootId: fileRoot.rootId })
        .all(),
    );
    if (changed.length === 0) return;
    yield* bump(root, unit);
  });

  const retire = Effect.fn('FileRootStore.retire')(function* (root: FileRoot, unit: WriteUnit<'machine'>) {
    const revision = yield* bump(root, unit);
    yield* unit.run(db.update(fileRoot).set({ state: 'retired', changedRevision: revision }).where(eq(fileRoot.rootId, root.rootId)));
  });

  const relocate = Effect.fn('FileRootStore.relocate')(function* (root: FileRoot, unit: WriteUnit<'machine'>) {
    const revision = yield* bump(root, unit);
    yield* unit.run(
      db
        .update(fileRoot)
        .set({
          path: root.path,
          locationRevision: root.locationRevision,
          changedRevision: revision,
          repositoryId: root.git?.repositoryId ?? null,
          gitDirectory: root.git?.gitDirectory.path ?? null,
        })
        .where(eq(fileRoot.rootId, root.rootId)),
    );
  });

  const bump = Effect.fn('FileRootStore.bump')(function* (root: FileRoot, unit: WriteUnit<'machine'>) {
    const current = yield* revision(root.namespaceId, unit);
    if (current === Number.MAX_SAFE_INTEGER) {
      return yield* new RootRefused({
        namespaceId: root.namespaceId,
        path: root.path,
        reason: 'revision-exhausted',
        message: 'The registry revision counter is exhausted.',
      });
    }
    const next = current + 1;
    yield* unit.run(
      db
        .insert(fileRootNamespace)
        .values({
          namespaceId: root.namespaceId,
          revision: next,
        })
        .onConflictDoUpdate({
          target: fileRootNamespace.namespaceId,
          set: { revision: next },
        }),
    );
    return next;
  });

  return {
    revision,
    byId,
    active,
    changesSince,
    page,
    identities,
    byIds,
    candidates,
    write,
    settle,
    settleAll,
    replaced,
    condemn,
    retire,
    relocate,
  };
});
