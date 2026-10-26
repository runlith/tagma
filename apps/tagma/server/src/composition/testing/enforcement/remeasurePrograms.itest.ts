import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Queue, Schema } from 'effect';
import { Measurement } from '../../../enforcement/contract/wire/enforcement.js';
import { driverOver, journalOver } from '../../../enforcement/testing/wiring.js';
import type { LandingJournal } from '../../../enforcement/contract/service/remeasure.js';
import type { CarriedViolation } from '../../../enforcement/contract/wire/enforcement.js';
import { MINE } from '../checkoutFixture.js';
import { BOUND, fp, programFixture, SEEDED, withProgram } from '../programFixture.js';

const WHOLE = `const git = (...args) => Bun.spawnSync(['git', ...args]).stdout.toString();
export default {
  forbidden: async ({ tree }) => {
    const findings = git('ls-tree', '-r', '--name-only', tree.commit, '--', 'src').trim().split('\\n').flatMap((path) =>
      git('show', tree.commit + ':' + path).split('\\n').flatMap((line, at) => {
        if (!line.includes('FORBIDDEN')) return [];
        return [{ fingerprint: path + ' × ' + line.slice(line.indexOf('FORBIDDEN')).trim(), path,
          line: line.includes('UNPLACED') ? undefined : at + 1, message: 'forbidden', fix: 'drop the FORBIDDEN marker' }];
      }));
    return { tree: { covered: 'reach', findings } };
  },
};`;

layer(programFixture(), { excludeTestServices: true })('program remeasurement', (it) => {
  it.effect('program remeasurement after landings reconciles debt and escapes by coverage', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        const demo = gate.current();
        const keep = fp('src/keep.ts × FORBIDDEN keep');
        const escaped = fp('src/escape.ts × FORBIDDEN escaped');
        yield* gate.put('src/keep.ts', 'export const keep = 1; // FORBIDDEN keep\n');
        yield* gate.committed('another standing violation');
        yield* gate.enforce({
          strictness: 'watch',
          inspection: BOUND,
          on: [{ op: 'submit_work', phase: 'after' }],
          owners: { [SEEDED]: gate.owner(), [keep]: gate.owner() },
        });
        const files = yield* FileSystem.FileSystem;
        const row = yield* demo.graph.blocks.blockById(yield* demo.graph.blockNames.idOfName(gate.rule()));
        const measured = join(demo.demoRoot, '.git/tagma/measured', `${row.uuid}.json`);
        const reading = files.readFileString(measured).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Measurement))));
        const completed = yield* Queue.unbounded<void>();
        const journal = journalOver(demo.graph.store.db, demo.graph.units);
        const observed: LandingJournal = {
          ...journal,
          remove: (key) => journal.remove(key).pipe(Effect.tap(() => Queue.offer(completed, undefined))),
        };
        const driver = yield* driverOver({ graphOf: () => Effect.succeed(gate.context()), delayMs: 0, journal: observed });
        const landed = Effect.fnUntraced(function* (paths: readonly string[], carried?: readonly CarriedViolation[]) {
          yield* driver.landed('submit_work', {
            kind: 'tree',
            projectId: demo.projectId,
            root: demo.demoRoot,
            commit: yield* gate.revision('HEAD'),
            paths,
            carried,
          });
          yield* Queue.take(completed);
        });
        yield* gate.put('src/a.ts', 'export const a = 1;\n');
        yield* gate.put('src/escape.ts', 'export const escaped = 1; // FORBIDDEN escaped\n');
        yield* gate.committed('fix debt and bypass the gate');
        gate.launches.length = 0;
        yield* landed(['src/a.ts', 'src/escape.ts']);
        const landedMeasurement = yield* reading;
        expect(landedMeasurement.commit).toBe(yield* gate.revision('HEAD'));
        expect(landedMeasurement.ms).toBeGreaterThan(0);
        expect((yield* gate.documentOf()).debt).toEqual([{ fingerprint: keep, owner: gate.owner() }]);
        expect((yield* gate.documentOf()).escaped).toEqual([
          {
            fingerprint: escaped,
            path: 'src/escape.ts',
            line: 1,
            said: 'forbidden: FORBIDDEN escaped',
            commit: yield* gate.revision('HEAD'),
          },
        ]);
        expect(gate.inputOf(gate.launches[0]).sides.map(({ side, paths }) => ({ side, paths }))).toEqual([
          { side: 'tree', paths: ['src/a.ts', 'src/escape.ts'] },
        ]);
        yield* gate.put('src/a.ts', 'export const a = 2;\n');
        yield* gate.committed('leave the escape untouched');
        yield* landed(['src/a.ts']);
        expect((yield* gate.documentOf()).escaped.map(({ fingerprint }) => fingerprint)).toEqual([escaped]);
        yield* (yield* FileSystem.FileSystem).remove(join(demo.demoRoot, 'src/escape.ts'));
        yield* gate.committed('remove the escaped violation');
        yield* landed(['src/escape.ts']);
        expect((yield* gate.documentOf()).escaped).toEqual([]);
        expect((yield* gate.documentOf()).debt).toEqual([{ fingerprint: keep, owner: gate.owner() }]);
        const duplicate = fp('src/a.ts × FORBIDDEN dup');
        const unplaced = fp('src/unplaced.ts × FORBIDDEN UNPLACED');
        yield* gate.put('tools/check.js', WHOLE);
        yield* gate.put('src/a.ts', 'export const a = 1; // FORBIDDEN dup\n');
        yield* gate.committed('a whole-reach checker with standing debt');
        yield* gate.enforce({ strictness: 'watch', owner: gate.owner(), absorb: 'all' });
        yield* gate.put('src/a.ts', 'export const a = 1; // FORBIDDEN dup\nexport const b = 2; // FORBIDDEN dup\n');
        yield* gate.put('src/unplaced.ts', 'export const unplaced = 1; // FORBIDDEN UNPLACED\n');
        yield* gate.committed('excess occurrence and an unplaced finding');
        const commit = yield* gate.revision('HEAD');
        yield* landed(
          ['src/a.ts', 'src/unplaced.ts'],
          [
            {
              rule: gate.rule(),
              title: 'forbidden',
              strictness: 'watch',
              fingerprint: duplicate,
              file: 'src/a.ts',
              line: 2,
              message: 'forbidden',
              fix: 'drop the FORBIDDEN marker',
              generalFix: 'Resolve the reported problem.',
              holders: [MINE],
            },
          ],
        );
        expect([...(yield* gate.documentOf()).debt].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))).toEqual([
          { fingerprint: duplicate, owner: gate.owner() },
          { fingerprint: keep, owner: gate.owner() },
        ]);
        expect((yield* gate.documentOf()).escaped).toEqual([
          {
            fingerprint: duplicate,
            path: 'src/a.ts',
            line: 2,
            said: 'forbidden',
            fix: 'drop the FORBIDDEN marker',
            commit,
            holder: MINE,
          },
          { fingerprint: unplaced, path: 'src/unplaced.ts', said: 'forbidden', fix: 'drop the FORBIDDEN marker', commit },
        ]);
        yield* gate.put(
          'tools/check.js',
          WHOLE.replace("if (!line.includes('FORBIDDEN'))", "if (!line.includes('FORBIDDEN') || line.includes('UNPLACED'))"),
        );
        yield* gate.put('src/a.ts', 'export const a = 1; // FORBIDDEN dup\n');
        yield* gate.committed('the full answer removes escapes outside the changed source paths');
        yield* landed(['tools/check.js', 'src/a.ts']);
        expect((yield* gate.documentOf()).escaped).toEqual([]);
        expect((yield* gate.documentOf()).debt).toHaveLength(2);
      }),
    ),
  );
});
