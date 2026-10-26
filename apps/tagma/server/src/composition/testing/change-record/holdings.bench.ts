import { Clock, Console, Effect, Tracer } from 'effect';
import { sql } from 'drizzle-orm';
import { workspaceChange, changeLogWrites } from '../../../change-record/store/tables.js';
import { fixture, layers, edited, BORN, GROWN, MINE } from './threadFilesWorld.js';

const history = Number(process.env.HOLDINGS_HISTORY ?? 160_000);
const paths = 64;
const background = Number(process.env.HOLDINGS_BACKGROUND ?? 500);
const versions = Number(process.env.HOLDINGS_VERSIONS ?? 200);
const inputs: Tracer.NativeSpan[] = [];
const tracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    if (span.name === 'Holdings.inputs') inputs.push(span);
    return span;
  },
});

await Effect.runPromise(
  Effect.gen(function* () {
    const world = yield* fixture;
    yield* world.units.write(changeLogWrites, (unit) =>
      unit.run(
        world.store.db.run(sql`with recursive n(x) as (
        select 1 union all select x+1 from n where x < ${history}
      ) insert into workspace_change(id,project_id,holder,checkout,path,state,origin,at)
      select 'ended-' || x, 1, ${MINE}, ${world.rootId}, 'kept.txt', 'committed', 'write', x from n`),
      ),
    );
    const asked = ['kept.txt'];
    for (let at = 0; at < paths; at += 1) {
      const path = `held-${at}.txt`;
      asked.push(path);
      yield* world.files.writeFileString(world.paths.join(world.root, path), GROWN);
      yield* edited(world.mine, world.paths.join(world.root, path), '', GROWN);
    }
    yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), GROWN);
    yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
    yield* world.holdings.settled(world.rootId);
    const samples = [];
    const clock = yield* Clock.Clock;
    for (let at = 0; at < 5; at += 1) {
      const start = clock.monotonicTimeNanosUnsafe();
      const judged = yield* world.holdings.judged(world.rootId, asked);
      if (judged.size !== asked.length || [...judged.values()].some((one) => one.holding.verdict.verdict !== 'proven')) {
        return yield* Effect.die(new Error('the benchmark holdings could not be proven'));
      }
      samples.push(Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000);
    }
    yield* Console.log(JSON.stringify({ history, standing: asked.length, samples }, null, 2));
    yield* Console.log(
      yield* world.store.db.all(sql`explain query plan select id, path from ${workspaceChange}
      where checkout=${world.rootId} and path in (${sql.join(
        asked.map((path) => sql`${path}`),
        sql`,`,
      )})
      and state in ('writing','held') order by path,at,id`),
    );
    const behind: string[] = [];
    for (let at = 0; at < background; at += 1) {
      const path = `behind-${at}.txt`;
      behind.push(path);
      yield* world.files.writeFileString(world.paths.join(world.root, path), GROWN);
      yield* edited(world.mine, world.paths.join(world.root, path), '', GROWN);
    }
    yield* world.holdings.settled(world.rootId);
    for (const path of [...behind, 'kept.txt'])
      yield* world.files.writeFileString(world.paths.join(world.root, path), `${GROWN}external\n`);
    const start = clock.monotonicTimeNanosUnsafe();
    yield* world.holdings.marked(world.rootId, undefined);
    yield* world.holdings.judged(world.rootId, ['kept.txt']);
    const urgent = Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000;
    yield* world.holdings.settled(world.rootId);
    const whole = Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000;
    yield* Console.log(JSON.stringify({ background, urgent, whole }));
    const file = world.paths.join(world.root, 'versions.txt');
    let text = '';
    const edit = Effect.fnUntraced(function* () {
      const next = `${text}line ${text.length}\n`;
      yield* world.files.writeFileString(file, next);
      yield* edited(world.mine, file, text, next);
      text = next;
    });
    const judgedOnce = Effect.fnUntraced(function* () {
      const start = clock.monotonicTimeNanosUnsafe();
      const judged = yield* world.holdings.judged(world.rootId, ['versions.txt']);
      if (judged.get('versions.txt')?.holding.verdict.verdict !== 'proven')
        return yield* Effect.die(new Error('the benchmark path could not be proven'));
      return {
        ms: Number(clock.monotonicTimeNanosUnsafe() - start) / 1_000_000,
        texts: inputs.map((span) => span.attributes.get('holdings.texts')),
      };
    });
    for (let at = 0; at < versions; at += 1) yield* edit();
    yield* world.holdings.settled(world.rootId);
    yield* judgedOnce();
    inputs.length = 0;
    yield* edit();
    const warm = yield* judgedOnce();
    yield* Console.log(JSON.stringify({ versions, warm }));
  }).pipe(Effect.scoped, Effect.provide(layers), Effect.withTracer(tracer)),
);
