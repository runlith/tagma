import { max } from 'drizzle-orm';
import { Effect, Layer, PubSub, Ref, Stream } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import { Documents } from './contract/service/documents.js';
import type { AppStateEvent } from './contract/wire/documents.js';
import { appDocument } from './store/tables.js';

const makeDocuments = Effect.gen(function* () {
  const db = (yield* MachineStore).db;
  const units = yield* MachineUnits;
  const changed = yield* Effect.acquireRelease(PubSub.unbounded<AppStateEvent>(), PubSub.shutdown);
  const newest = () =>
    db
      .select({ revision: max(appDocument.revision) })
      .from(appDocument)
      .get();
  const top = yield* Ref.make(yield* units.read((unit) => Effect.map(unit.run(newest()), (row) => row?.revision ?? 0)));
  const published = (event: AppStateEvent & { readonly kind: 'changed' }) =>
    Effect.andThen(
      Ref.update(top, (revision) => Math.max(revision, event.revision)),
      Effect.asVoid(PubSub.publish(changed, event)),
    );

  return Documents.of({
    read: units.read((unit) =>
      Effect.map(unit.run(db.select().from(appDocument).all()), (rows) => ({
        documents: rows.flatMap((row) => (row.value === null ? [] : [{ key: row.key, value: row.value, revision: row.revision }])),
        revision: rows.reduce((top, row) => Math.max(top, row.revision), 0),
      })),
    ),
    write: Effect.fn('Documents.write')(({ key, value, writer }) =>
      units.write(writes('Documents.write', [appDocument]), (unit) =>
        Effect.gen(function* () {
          const revision = ((yield* unit.run(newest()))?.revision ?? 0) + 1;
          yield* unit.run(
            db
              .insert(appDocument)
              .values({ key, value, revision })
              .onConflictDoUpdate({ target: appDocument.key, set: { value, revision } }),
          );
          yield* unit.afterCommit(published({ kind: 'changed', key, value, revision, writer }));
          return revision;
        }),
      ),
    ),
    changes: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changed);
        const opened: AppStateEvent = { kind: 'current', revision: yield* Ref.get(top) };
        return Stream.concat(Stream.make(opened), Stream.fromSubscription(subscription));
      }),
    ),
  });
});

export const documentsLayer = Layer.effect(Documents, makeDocuments);
