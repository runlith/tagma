import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { THEIRS } from '../checkoutFixture.js';
import { base, commandLayer, commandWorld } from './commandWorld.js';
import { naming } from '../../../change-record/testing/doubles.js';
import { OVERLAP_REASON } from '../../../change-record/record/commands.js';
import { TEAM_REASON } from '../../../change-record/contract/service/commands.js';

const ROOT = 'root';
const LEFT = 'leftie';
const RIGHT = 'rightish';

const teamWrite = Effect.fnUntraced(function* () {
  const s = yield* commandWorld({ teams: true });
  yield* s.w.namedAgent(ROOT, { name: ROOT, task: 'leads the team' });
  for (const id of [LEFT, RIGHT]) yield* s.w.namedAgent(id, { name: id, task: 'team work', parent: ROOT });
  const from = yield* Clock.currentTimeMillis;
  const active = yield* Effect.forEach([LEFT, RIGHT], (threadId) =>
    Effect.flatMap(
      s.record.changes({ work: { projectId: s.w.projectId, threadId } }).command?.(s.w.root, naming(s.w.root)) ?? Effect.succeed(null),
      (life) => (life === null ? Effect.die('the checkout opened no command window') : Effect.succeed(life)),
    ),
  );
  for (const life of active) life.opened();
  const text = base.replace('const five = 5;', 'const five = 50;');
  writeFileSync(join(s.w.root, 'src/a.ts'), text);
  const writtenAt = yield* Clock.currentTimeMillis;
  for (const life of active) life.ended();
  const verdicts = yield* Effect.forEach(active, (life) =>
    life
      .settle({
        base: null,
        window: { from, to: writtenAt },
        moves: [
          {
            name: 'src/a.ts',
            before: contentDigest(base),
            after: contentDigest(text),
            present: true,
            existed: true,
            written: { from: writtenAt, to: writtenAt },
            bytes: null,
            link: false,
            mode: null,
          },
        ],
      })
      .pipe(Effect.ensuring(Effect.sync(life.close))),
  );
  yield* s.decided(LEFT);
  return { s, text, verdicts };
});

layer(commandLayer, { excludeTestServices: true })('team command landing', (it) => {
  it.effect('a write met only by commands of one thread tree lands whole with the root’s bare submit once its members rest', () =>
    Effect.gen(function* () {
      const { s, text, verdicts } = yield* teamWrite();
      expect(verdicts).toEqual([[{ name: 'src/a.ts', verdict: 'team' }], [{ name: 'src/a.ts', verdict: 'team' }]]);
      expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: LEFT })).toMatchObject([
        { path: 'src/a.ts', reason: TEAM_REASON, team: ROOT },
      ]);
      expect(yield* s.w.submit(ROOT, { commands: s.commands })).toMatchObject({ status: 'landed', committed: ['src/a.ts'] });
      expect(yield* s.w.run(['show', 'HEAD:src/a.ts'])).toBe(text.trimEnd());
    }),
  );
  it.effect('a named birth never adopts an off-path team-observed deletion as a move', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld({ teams: true });
      yield* s.w.namedAgent(ROOT, { name: ROOT, task: 'leads the team' });
      yield* s.w.namedAgent(LEFT, { name: LEFT, task: 'copies a file', parent: ROOT });
      const text = `export const source = "${'shared bytes '.repeat(8)}";\n`;
      yield* s.w.based({ 'source.ts': text, 'outside.ts': text });
      const head = yield* s.w.run(['rev-parse', 'HEAD']);
      const from = yield* Clock.currentTimeMillis;
      const life = yield* s.record.changes({ work: { projectId: s.w.projectId, threadId: LEFT } }).command!(
        s.w.root,
        naming(join(s.w.root, 'new.ts')),
      );
      if (life === null) return yield* Effect.die('the checkout opened no command window');
      life.opened();
      writeFileSync(join(s.w.root, 'new.ts'), text);
      unlinkSync(join(s.w.root, 'outside.ts'));
      const to = yield* Clock.currentTimeMillis;
      life.ended();
      yield* life.settle({
        base: head,
        window: { from, to },
        moves: [
          {
            name: 'new.ts',
            before: null,
            after: contentDigest(text),
            present: true,
            existed: false,
            written: { from: to, to },
            bytes: null,
            link: false,
            mode: null,
          },
          {
            name: 'outside.ts',
            before: null,
            after: contentDigest(''),
            present: false,
            existed: true,
            written: { from, to },
            bytes: null,
            link: false,
            mode: null,
          },
        ],
      });
      life.close();
      yield* s.decided(LEFT);
      expect(yield* s.held('outside.ts')).toEqual([]);
      expect((yield* s.held('new.ts')).map(([thread]) => thread)).toEqual([LEFT]);
    }),
  );
  it.effect('a path the commands of two thread trees met lands with a bare submit of either', () =>
    Effect.gen(function* () {
      const { s, text } = yield* teamWrite();
      const at = yield* Clock.currentTimeMillis;
      s.commands.remembered([
        {
          projectId: s.w.projectId,
          threadId: THEIRS,
          checkout: 'repo-root',
          path: 'src/a.ts',
          reason: OVERLAP_REASON,
          team: null,
          digest: null,
          commandLine: null,
          at,
        },
      ]);
      expect(yield* s.w.submit(THEIRS, { commands: s.commands })).toMatchObject({ status: 'landed', committed: ['src/a.ts'] });
      expect(yield* s.w.run(['show', 'HEAD:src/a.ts'])).toBe(text.trimEnd());
    }),
  );
});
