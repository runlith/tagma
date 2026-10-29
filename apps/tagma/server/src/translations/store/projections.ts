import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { translationAct, translationPart } from './tables.js';

export type ActRow = typeof translationAct.$inferSelect;
export type PartRow = typeof translationPart.$inferSelect;

export type ProjectionKey = { readonly projectId: number; readonly block: string; readonly language: string };

export type ActEnding = {
  readonly ending: NonNullable<ActRow['ending']>;
  readonly reason: string | null;
  readonly failed: number;
  readonly keep: readonly string[];
};

export type TitleAsk = { readonly projectId: number; readonly block: string; readonly source: string };

const PART_COLUMNS = 5;

const KEY_COLUMNS = 4;

const at = (key: ProjectionKey) =>
  and(eq(translationPart.projectId, key.projectId), eq(translationPart.block, key.block), eq(translationPart.language, key.language));

const actAt = (key: ProjectionKey) =>
  and(eq(translationAct.projectId, key.projectId), eq(translationAct.block, key.block), eq(translationAct.language, key.language));

export const makeProjections = Effect.gen(function* () {
  const db = (yield* MachineStore).db;
  const units = yield* MachineUnits;

  return {
    acts: (projectId: number, block: string) =>
      units.read((unit) =>
        unit.run(
          db
            .select()
            .from(translationAct)
            .where(and(eq(translationAct.projectId, projectId), eq(translationAct.block, block)))
            .all(),
        ),
      ),
    parts: (projectId: number, block: string) =>
      units.read((unit) =>
        unit.run(
          db
            .select()
            .from(translationPart)
            .where(and(eq(translationPart.projectId, projectId), eq(translationPart.block, block)))
            .all(),
        ),
      ),
    titles: (asks: readonly TitleAsk[], language: string) =>
      units.read((unit) =>
        Effect.gen(function* () {
          const found: PartRow[] = [];
          const step = rowsPerStatement(KEY_COLUMNS);
          for (let from = 0; from < asks.length; from += step) {
            const keys = asks
              .slice(from, from + step)
              .map((ask) => and(at({ projectId: ask.projectId, block: ask.block, language }), eq(translationPart.source, ask.source)));
            found.push(
              ...(yield* unit.run(
                db
                  .select()
                  .from(translationPart)
                  .where(or(...keys))
                  .all(),
              )),
            );
          }
          return found;
        }),
      ),
    last: (projectId: number) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ language: translationAct.language })
              .from(translationAct)
              .where(eq(translationAct.projectId, projectId))
              .orderBy(desc(translationAct.at))
              .limit(1)
              .all(),
          ),
          (rows) => rows[0]?.language ?? null,
        ),
      ),
    begin: (key: ProjectionKey, act: { readonly model: string; readonly rung: string | null; readonly at: number }) =>
      units.write(writes('Projections.begin', [translationAct]), (unit) =>
        unit.run(
          db
            .insert(translationAct)
            .values({ ...key, ...act, ending: null, reason: null, failed: 0 })
            .onConflictDoUpdate({
              target: [translationAct.projectId, translationAct.block, translationAct.language],
              set: { ...act, ending: null, reason: null, failed: 0 },
            }),
        ),
      ),
    land: (key: ProjectionKey, texts: ReadonlyMap<string, string>) =>
      units.write(writes('Projections.land', [translationPart]), (unit) =>
        Effect.gen(function* () {
          const rows = [...texts].map(([source, text]) => ({ ...key, source, text }));
          const step = rowsPerStatement(PART_COLUMNS);
          for (let from = 0; from < rows.length; from += step) {
            yield* unit.run(
              db
                .insert(translationPart)
                .values(rows.slice(from, from + step))
                .onConflictDoUpdate({
                  target: [translationPart.projectId, translationPart.block, translationPart.language, translationPart.source],
                  set: { text: sql`excluded.text` },
                }),
            );
          }
        }),
      ),
    end: (key: ProjectionKey, ended: ActEnding) =>
      units.write(writes('Projections.end', [translationAct, translationPart]), (unit) =>
        Effect.gen(function* () {
          yield* unit.run(
            db.update(translationAct).set({ ending: ended.ending, reason: ended.reason, failed: ended.failed }).where(actAt(key)),
          );
          const keep = new Set(ended.keep);
          const stored = yield* unit.run(db.select({ source: translationPart.source }).from(translationPart).where(at(key)).all());
          const stale = stored.map((row) => row.source).filter((source) => !keep.has(source));
          const step = rowsPerStatement(1);
          for (let from = 0; from < stale.length; from += step) {
            yield* unit.run(
              db.delete(translationPart).where(and(at(key), inArray(translationPart.source, stale.slice(from, from + step)))),
            );
          }
        }),
      ),
    forget: (projectId: number) =>
      units.write(writes('Projections.forget', [translationAct, translationPart]), (unit) =>
        Effect.gen(function* () {
          yield* unit.run(db.delete(translationPart).where(eq(translationPart.projectId, projectId)));
          yield* unit.run(db.delete(translationAct).where(eq(translationAct.projectId, projectId)));
        }),
      ),
  };
});

export class Projections extends Context.Service<Projections, Effect.Success<typeof makeProjections>>()('translations/Projections') {}

export const projectionsLayer = Layer.effect(Projections, makeProjections);
