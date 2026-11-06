import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer } from 'effect';
import { PROBE_MAX_FILES } from '@tagma/inspection/node/budget';
import { doorFixture } from '../composition/testing/doorFixture.js';
import { nativeLanding } from '../composition/testing/landing/native.js';

const config = `export default ${JSON.stringify({
  inspections: {
    recovery: {
      builtin: 'swallowed-failures',
      params: { base: 'src', region: ['core/'], files: { extensions: ['.ts'], exclude: [] }, allow: [] },
    },
  },
})};\n`;

const PATHS = Array.from({ length: PROBE_MAX_FILES + 1 }, (_, at) => `src/core/part${at}.ts`);

const setup = nativeLanding(
  {
    'package.json': JSON.stringify({ name: 'calibrating', dependencies: { effect: '4.0.1' } }),
    'tagma.config.ts': config,
    [PATHS[0]!]: 'export const part0 = 0;\n',
  },
  { tools: ['check_rules', 'submit_work'], own: 'inspection workers no earlier judgement has calibrated' },
);

class Calibrating extends Context.Service<Calibrating, Effect.Success<typeof setup>>()('testing/Calibrating') {}

layer(Layer.effect(Calibrating, setup).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('calibration on a cold server', (it) => {
  it.effect('check_rules over a change past the probe judges an enforced calibrated rule on its first judgement', () =>
    Effect.gen(function* () {
      const { world, projectId, born, doors, write } = yield* Calibrating;
      const project = `project=${projectId}`;
      const parentId = ((yield* world.op('list_root_blocks', {}, project)).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const created = yield* world.op('create_block', { parentId, tags: ['rule'], title: 'No swallowed failures' }, project);
      const blockId = (created.body as { block: { name: string } }).block.name;
      expect(
        yield* world.op(
          'enforce_rule',
          { blockId, base: null, inspection: 'recovery', strictness: 'gate', on: [{ op: 'submit_work', phase: 'before' }] },
          project,
        ),
      ).toMatchObject({ status: 200 });
      const actor = yield* born();
      for (const [at, path] of PATHS.entries()) yield* write(actor.threadId, path, `export const part${at} = ${at + 1};\n`);
      expect(yield* doors.atNative('check_rules', { over: 'change', limit: 10 }, actor)).toMatchObject({
        class: 'answer',
        value: { refuses: false, violations: [], unjudged: [] },
      });
    }),
  );
});
