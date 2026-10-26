import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { join } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { call } from '../checkoutFixture.js';
import { doorFixture } from '../doorFixture.js';
import { nativeLanding } from './native.js';

const text = (...lines: string[]) => `${lines.join('\n')}\n`;
const id = '    threadId: string,';
const unit = "    unit: WriteUnit<'machine'>,";
const choice = '    choice: HarnessModelChoice | undefined,';
const facet = '      ...facet,';
const tail = ['      sessionKey: null,', '      observation: null,', '      session: { ...session, seed: true },'];
const reordered = text(
  '',
  id,
  '    sessionId: string,',
  unit,
  choice,
  '      }',
  '      session: { ...session, cut },',
  '    };',
  unit,
  choice,
  facet,
  ...tail,
  '',
  id,
);
const rewritten = text(
  unit,
  choice,
  facet,
  ...tail,
  '',
  id,
  '    sessionId: string,',
  '      }',
  facet,
  '      session: { ...session, cut },',
  '    };',
  '',
);
const counted = text('export function total(rows: readonly number[]) {', '  return rows.length;', '}');
const declared = counted.replace('  return', '  const first = rows[0] ?? 0;\n  return');
const used = declared.replace('rows.length;', 'rows.length + first;');

const setup = nativeLanding({ 'alignment.ts': reordered, 'total.ts': counted }, { tools: ['submit_work', 'read_changes'] }).pipe(
  Effect.provide(BunFileSystem.layer),
);

class Landing extends Context.Service<Landing, Effect.Success<typeof setup>>()('testing/NobodyLanding') {}

layer(Layer.effect(Landing, setup).pipe(Layer.provide(doorFixture())), { excludeTestServices: true })(
  'native submit_work and lines nobody holds',
  (it) => {
    it.effect(
      'a write that moves repeated lines holds every line it wrote and lands them, and a nobody-held declaration its edit uses refuses until carried whole',
      () =>
        Effect.gen(function* () {
          const { world, files, root, projectId, born, doors, read } = yield* Landing;
          const actor = yield* born();
          const tools = createTools({
            cwd: root,
            world: machineWorld,
            changes: Context.get(world.runtime.owners, ChangeRecord).changes({ work: { projectId, threadId: actor.threadId } }),
            commandTimes: unruledTimes,
            searchMs: 1000,
          });
          yield* call(tools.write!, { path: join(root, 'alignment.ts'), content: rewritten });
          expect(yield* doors.atNative('read_changes', { path: 'alignment.ts' }, actor)).toMatchObject({
            class: 'answer',
            value: { holdings: [{ holding: { verdict: { verdict: 'proven', nobody: [] } } }] },
          });
          expect(yield* doors.atNative('submit_work', { subject: 'move the repeated lines' }, actor)).toMatchObject({
            class: 'answer',
            value: { submitted: { status: 'landed', committed: ['alignment.ts'] } },
          });
          expect(yield* read('alignment.ts')).toBe(rewritten);

          yield* files.writeFileString(join(root, 'total.ts'), declared);
          yield* call(tools.edit!, { path: join(root, 'total.ts'), oldString: 'rows.length;', newString: 'rows.length + first;' });
          const refused = yield* doors.atNative('submit_work', { subject: 'use the declaration nobody holds' }, actor);
          expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
          if (refused.class !== 'refusal') return;
          expect(refused.reason).toContain('first in total.ts:2, held by nobody');
          expect(yield* read('total.ts')).toBe(counted);
          expect(yield* doors.atNative('submit_work', { subject: 'carry the declaration', whole: ['total.ts'] }, actor)).toMatchObject({
            class: 'answer',
            value: { submitted: { status: 'landed', committed: ['total.ts'] } },
          });
          expect(yield* read('total.ts')).toBe(used);
        }),
    );
  },
);
