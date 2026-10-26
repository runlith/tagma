import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { WorkspaceChanges } from '@runlith/agent-tools/WorkspaceChanges';
import { BORN, GONE, MINE, THEIRS, edited, entriesOf, fixture, layers, run } from './threadFilesWorld.js';
type World = Effect.Success<typeof fixture>;
const FILES = ['kept.txt', 'a.txt', 'b.txt'] as const;
const STEPS = 10;
const SEEDS = [7, 1013];
const random = (seed: number) => {
  let state = seed >>> 0;
  return (below: number): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % below) as number;
  };
};
const lines = (text: string): string[] => text.split('\n').slice(0, -1);
const agreed = Effect.fnUntraced(function* (world: World) {
  yield* world.holdings.settled(world.rootId);
  const totals = yield* world.holdings.threads([MINE, THEIRS, GONE]);
  for (const thread of [MINE, THEIRS, GONE]) {
    const panel = yield* world.list(thread);
    const total = totals.get(thread) ?? { paths: 0, unproven: 0, outside: 0 };
    const entries = entriesOf(panel);
    expect({ thread, paths: total.paths, unproven: total.unproven }).toEqual({
      thread,
      paths: entries.filter((entry) => entry.section === 'uncommitted').length,
      unproven: entries.filter((entry) => entry.section === 'unproven').length,
    });
    expect(panel.held).toEqual({ paths: total.paths, unproven: total.unproven });
  }
});
layer(layers, { excludeTestServices: true })('holdings against panels', (it) => {
  for (const seed of SEEDS)
    it.effect(
      `seed ${seed}: across random edits, external writes, reverts and commits by three sessions, each session’s held and unproven counts equal its panel`,
      () =>
        Effect.gen(function* () {
          {
            const world = yield* fixture;
            const pick = random(seed);
            const at = (file: string) => world.paths.join(world.root, file);
            for (const file of FILES.slice(1)) yield* world.files.writeFileString(at(file), BORN);
            yield* run(world.git, world.root, ['add', '--', ...FILES.slice(1)]);
            yield* run(world.git, world.root, ['commit', '-q', '-m', 'seeded']);
            yield* world.holdings.moved(world.rootId, 'all');
            const ports: Readonly<Record<string, WorkspaceChanges>> = { [MINE]: world.mine, [THEIRS]: world.theirs, [GONE]: world.gone };
            const threads = [MINE, THEIRS, GONE] as const;
            const last = new Map<
              string,
              {
                readonly thread: string;
                readonly before: string;
              }
            >();
            for (let step = 0; step < STEPS; step += 1) {
              const file = FILES[pick(FILES.length)] as string;
              const now = yield* world.files.readFileString(at(file));
              const move = pick(10);
              if (move < 6) {
                const thread = threads[pick(threads.length)] as string;
                const rows = lines(now);
                const line = `${thread} ${step}`;
                if (rows.length > 0 && pick(2) === 0) rows[pick(rows.length)] = line;
                else rows.splice(pick(rows.length + 1), 0, line);
                const after = `${rows.join('\n')}\n`;
                yield* world.files.writeFileString(at(file), after);
                yield* edited(ports[thread] as WorkspaceChanges, at(file), now, after);
                last.set(file, { thread, before: now });
              } else if (move < 7) {
                yield* world.files.writeFileString(at(file), `${now}external ${step}\n`);
                yield* world.holdings.moved(world.rootId, [file]);
              } else if (move < 9) {
                const undo = last.get(file);
                if (undo === undefined) continue;
                yield* world.files.writeFileString(at(file), undo.before);
                yield* edited(ports[undo.thread] as WorkspaceChanges, at(file), now, undo.before);
                last.delete(file);
              } else {
                yield* run(world.git, world.root, ['add', '--', file]);
                yield* run(world.git, world.root, ['commit', '-q', '--allow-empty', '-m', `step ${step}`]);
                yield* world.holdings.moved(world.rootId, 'all');
              }
              yield* agreed(world);
            }
          }
        }),
    );
});
