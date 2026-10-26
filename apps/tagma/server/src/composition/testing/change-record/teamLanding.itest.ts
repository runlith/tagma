import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
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

const takingLeft = [{ threadId: LEFT, label: LEFT }];

layer(commandLayer, { excludeTestServices: true })('team command landing', (it) => {
  it.effect(
    'a write met only by commands of one thread tree is the team’s: its root lands it by taking a member, and neither the member alone nor a sibling taking it does',
    () =>
      Effect.gen(function* () {
        const { s, text, verdicts } = yield* teamWrite();
        expect(verdicts).toEqual([[{ name: 'src/a.ts', verdict: 'team' }], [{ name: 'src/a.ts', verdict: 'team' }]]);
        expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: LEFT })).toMatchObject([
          { path: 'src/a.ts', reason: TEAM_REASON, team: ROOT },
        ]);
        expect(yield* s.w.submit(LEFT, { commands: s.commands })).toMatchObject({ status: 'nothing' });
        expect(yield* s.w.submit(RIGHT, { commands: s.commands, taking: takingLeft })).toMatchObject({ status: 'nothing' });
        expect(yield* s.w.submit(ROOT, { commands: s.commands, taking: takingLeft })).toMatchObject({
          status: 'landed',
          committed: ['src/a.ts'],
        });
        expect(yield* s.w.run(['show', 'HEAD:src/a.ts'])).toBe(text.trimEnd());
      }),
    20_000,
  );
  it.effect(
    'a team path another session’s command also met stays out of the root’s landing without paths',
    () =>
      Effect.gen(function* () {
        const { s } = yield* teamWrite();
        const at = yield* Clock.currentTimeMillis;
        s.commands.remembered([
          { projectId: s.w.projectId, threadId: THEIRS, checkout: 'repo-root', path: 'src/a.ts', reason: OVERLAP_REASON, team: null, at },
        ]);
        expect(yield* s.w.submit(ROOT, { commands: s.commands, taking: takingLeft })).toMatchObject({ status: 'nothing' });
      }),
    20_000,
  );
});
