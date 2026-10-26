import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { storeLayer } from '../../../platform/store/open.js';
import { inDatabase } from '../../../platform/testing/connection.js';
import { sourceStore } from '../../../platform/testing/baseline.js';
import { chain } from '../../../platform/store/chain.js';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';

const BEFORE_MEASURE = '20261010165954_rollout_form_step';

type RuleRow = {
  readonly id: string;
  readonly project_id: number | null;
  readonly position: number;
  readonly measure: string;
  readonly limit_ms: number;
};

layer(BunFileSystem.layer, { excludeTestServices: true })('command-rule measure migration', (it) => {
  it.effect(
    'the measure migration marks every standing rule a life and carries the default command time into a life rule of its own scope',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const root = yield* files.makeTempDirectoryScoped({ prefix: 'command-rule-measure-' });
        const path = join(root, 'store.sqlite');
        yield* Effect.sync(() =>
          sourceStore(
            path,
            fixtureMigrations,
            chain(fixtureMigrations).findIndex((migration) => migration.name === BEFORE_MEASURE),
          ),
        );
        yield* inDatabase(path, (db) =>
          Effect.gen(function* () {
            yield* db.run(sql`insert into project (id, name, repo_key, root_path, created_at) values (7, 'seven', '/seven', '/seven', 0)`);
            yield* db.run(sql`insert into setting (scope, project_id, key, value, declined, updated_at) values
          ('user', null, 'command.defaultMs', '120000', 0, 1000),
          ('project', 7, 'command.defaultMs', '900000', 0, 2000)`);
            yield* db.run(sql`insert into command_rule (id, project_id, thread_id, position, through, program, limit_ms, writer, written_at, words) values
          ('machine1', null, null, 0, null, null, 300000, 'operator', 0, 'five minutes everywhere'),
          ('project1', 7, null, 0, 'bash', null, 600000, 'operator', 0, 'ten minutes here')`);
          }),
        );

        yield* Effect.scoped(
          Layer.build(Layer.orDie(storeLayer(MachineStore, path, fixtureMigrations, { durable: false }, yield* sharedPool))),
        );

        const [rules, settings] = yield* inDatabase(path, (db) =>
          Effect.all([
            db.all<RuleRow>(sql`select id, project_id, position, measure, limit_ms from command_rule order by project_id, position`),
            db.all<{ readonly key: string }>(sql`select key from setting where key = 'command.defaultMs'`),
          ]),
        );
        const carried = rules.filter((rule) => rule.id !== 'machine1' && rule.id !== 'project1');
        expect(rules.find((rule) => rule.id === 'machine1')).toMatchObject({ measure: 'life', position: 1, limit_ms: 300_000 });
        expect(rules.find((rule) => rule.id === 'project1')).toMatchObject({ measure: 'life', position: 1, limit_ms: 600_000 });
        expect(carried.map((rule) => [rule.project_id, rule.position, rule.measure, rule.limit_ms])).toEqual([
          [null, 0, 'life', 120_000],
          [7, 0, 'life', 900_000],
        ]);
        expect(settings).toEqual([]);
      }),
  );
});
