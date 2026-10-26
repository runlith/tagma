import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { makeTerminalWorld } from '../fixture.js';
import { born, hookThreads, running } from '../hookFixture.js';

const RULE = 'Gate values change only through the release table';
const NOTE = 'Why the gate value is a constant';
const BODY = 'The release script reads the value textually.';

const setup = Effect.gen(function* () {
  const world = yield* makeTerminalWorld();
  const files = yield* FileSystem.FileSystem;
  const project = yield* world.checkout();
  yield* files.writeFileString(join(project.root, 'gate.ts'), 'export const value = 1;\n');
  const blocks = Context.get(world.runtime.graph, Blocks);
  const sources = [{ kind: 'file' as const, ref: 'gate.ts' }];
  yield* Effect.provide(
    Effect.andThen(
      blocks.create({ projectId: project.id, tags: ['rule'], title: RULE, sources }),
      blocks.create({ projectId: project.id, tags: ['explanation'], title: NOTE, body: BODY, sources }),
    ),
    world.runtime.owners,
  );
  return { project, threads: hookThreads(world) };
});

class First extends Context.Service<First, Effect.Success<typeof setup>>()('testing/HookFirst') {}

const posted = Effect.fnUntraced(function* (key: string, id: string, event: Record<string, unknown>) {
  const { project, threads } = yield* First;
  const answered = yield* threads.hook(
    'post-tool-use',
    project.root,
    { hook_event_name: 'PostToolUse', session_id: key, cwd: project.root, ...event },
    id,
    null,
  );
  return answered.out;
});

layer(Layer.effect(First, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('the first hook on a cold server', (it) => {
  it.effect(
    'the first Claude Grep a server ever hears for a project brings the rule of what it found and a pointer to its note, and the next Read brings the note',
    () =>
      Effect.gen(function* () {
        const { project, threads } = yield* First;
        const id = yield* threads.bornThread(crypto.randomUUID(), project.id, yield* running(born('claude-code', 'first')));
        const grep = yield* posted('first', id, {
          tool_name: 'Grep',
          tool_input: { pattern: 'value', output_mode: 'content' },
          tool_response: { mode: 'content', numFiles: 0, filenames: [], content: 'gate.ts:1:export const value = 1;', numLines: 1 },
        });
        expect([grep.includes(RULE), grep.includes(NOTE), grep.includes(BODY)]).toEqual([true, true, false]);
        const read = yield* posted('first', id, { tool_name: 'Read', tool_input: { file_path: join(project.root, 'gate.ts') } });
        expect(read.includes(BODY)).toBe(true);
      }),
  );
});
