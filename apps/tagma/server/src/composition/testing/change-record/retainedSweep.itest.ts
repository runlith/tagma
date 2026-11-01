import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { OVERLAP_REASON } from '../../../change-record/record/commands.js';
import { MINE, THEIRS } from '../checkoutFixture.js';
import { commandLayer, commandWorld } from './commandWorld.js';

const ENDED = 'ended-session';

layer(commandLayer, { excludeTestServices: true })('retained command paths', (it) => {
  it.effect('a landing sweeps the checkout’s unattributed paths that stand clean and retires those of ended sessions', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* s.w.namedAgent(ENDED, { name: ENDED, task: 'ended work', ended: true });
      writeFileSync(join(s.w.root, 'standing.txt'), 'still changed\n');
      const at = yield* Clock.currentTimeMillis;
      const entry = (threadId: string, path: string) => ({
        projectId: s.w.projectId,
        threadId,
        checkout: 'repo-root',
        path,
        reason: OVERLAP_REASON,
        team: null,
        digest: null,
        commandLine: null,
        at,
      });
      s.commands.remembered([entry(THEIRS, 'standing.txt'), entry(THEIRS, 'src/a.ts'), entry(ENDED, 'standing.txt')]);
      writeFileSync(join(s.w.root, 'src', 'b.ts'), 'export const b = 1;\n');
      yield* s.w.record(MINE, '', 'export const b = 1;\n', { path: 'src/b.ts', origin: 'write' });

      const landed = yield* s.w.submit(MINE, { commands: s.commands, record: s.record, paths: ['src/b.ts'] });
      expect(landed).toMatchObject({ status: 'landed', committed: ['src/b.ts'] });
      expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: THEIRS }).map((one) => one.path)).toEqual(['standing.txt']);
      expect(s.commands.unattributed({ projectId: s.w.projectId, threadId: ENDED })).toEqual([]);
    }),
  );
});
