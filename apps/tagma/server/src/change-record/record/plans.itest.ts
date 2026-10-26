import { turnsOf } from '../changes/turns.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Database } from 'bun:sqlite';
import { Effect, Layer, Tracer } from 'effect';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../platform/store/units.js';
import { project } from '../../projects/store/table.js';
import { workspaceChange } from '../store/tables.js';
import { evidenceOfPath, heldOfThread } from './evidence.js';
import { commitsOfThread, heldPathsOfProject, landedOfThread, pathsOfCommit, pathsOfThread, writtenOfThread } from './reads.js';

const layer = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);

it.live('response and judge reads search the change record through indexes', () =>
  Effect.gen(function* () {
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'plans', repoKey: '/plans', rootPath: '/plans', createdAt: new Date(0) });
    yield* store.db.insert(workspaceChange).values([
      {
        id: 'held',
        projectId: 1,
        holderProjectId: 1,
        holder: 'writer',
        checkout: 'checkout',
        path: 'file',
        state: 'held',
        origin: 'write',
        at: new Date(1),
      },
      {
        id: 'landed',
        projectId: 1,
        holderProjectId: 1,
        holder: 'writer',
        checkout: 'checkout',
        path: 'other',
        state: 'committed',
        origin: 'write',
        at: new Date(2),
        commit: 'abc',
        committedAt: new Date(3),
      },
    ]);
    const place = { checkout: 'checkout', path: 'file' };
    const questions: readonly Effect.Effect<unknown, StoreFailure>[] = [
      pathsOfThread(units, store, 1, 'writer', place.checkout),
      turnsOf(units, store, 1, 'writer', 10),
      writtenOfThread(units, store, 1, 'writer'),
      landedOfThread(units, store, 1, 'writer', ['other'], place.checkout),
      commitsOfThread(units, store, 1, 'writer', place.checkout, { from: 0, count: 10 }),
      pathsOfCommit(units, store, 1, 'writer', 'abc', place.checkout),
      heldPathsOfProject(units, store, place.checkout),
      heldOfThread(units, store, 1, 'writer'),
      evidenceOfPath(units, store, place),
    ];
    const db = new Database(store.path, { readonly: true });
    try {
      for (const question of questions) {
        spans.length = 0;
        yield* question.pipe(Effect.withTracer(tracer));
        const queries = spans.flatMap((span) => {
          const text = span.attributes.get('db.query.text');
          return typeof text === 'string' && /\bfrom\s+"workspace_change"/i.test(text) ? [text] : [];
        });
        expect(queries.length).toBeGreaterThan(0);
        for (const query of queries) {
          const statement = db.query<{ detail: string }, (string | null)[]>(`EXPLAIN QUERY PLAN ${query}`);
          const plan = statement.all(...Array.from({ length: statement.paramsCount }, () => null));
          const accesses = plan.filter((step) => /\b(?:SEARCH|SCAN) workspace_change\b/.test(step.detail));
          expect(accesses.length).toBeGreaterThan(0);
          expect(accesses.every((step) => step.detail.startsWith('SEARCH '))).toBe(true);
        }
      }
    } finally {
      db.close();
    }
  }).pipe(Effect.provide(layer)),
);
