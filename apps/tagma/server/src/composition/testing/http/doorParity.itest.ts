import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Result } from 'effect';
import { toolArguments } from '@runlith/agent/tool/arguments';
import { makeDoorWorld } from '../doorFixture.js';
import { makeThreadDoors, type Outcome } from '../threadDoors.js';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const project = yield* world.stealthProject();
  const created = yield* world.op('create_thread', { title: 'door caller' }, `project=${project}`);
  expect(created.status).toBe(200);
  const thread = (created.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
  const calls = makeThreadDoors(world, project, ['read_settings', 'create_block', 'read_block', 'enforce_rule']);
  return { world, project, calls, doors: yield* calls.doorsFor(thread.id, thread.ownerId) };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ParityPlace') {}

const answerOf = (outcome: Outcome) =>
  outcome.class === 'answer' ? Effect.succeed(outcome.value) : Effect.die(new Error(`the door refused: ${JSON.stringify(outcome)}`));

layer(Layer.effect(Place, setup), { excludeTestServices: true })('door parity', (it) => {
  it.effect('HTTP and native calls carry the same caller, answer and typed refusals', () =>
    Effect.gen(function* () {
      const { world, project, calls, doors } = yield* Place;
      const http = (id: string, input: unknown) => calls.atHttp(id, input, doors);
      const native = (id: string, input: unknown) => calls.atNative(id, input, doors);
      const read = yield* http('read_settings', {});
      expect(read.class).toBe('answer');
      expect(yield* native('read_settings', {})).toEqual(read);

      const missing = { blockIds: ['ffffffffffff'] };
      const refused = yield* http('read_block', missing);
      expect(refused.class).toBe('refusal');
      expect(yield* native('read_block', missing)).toEqual(refused);

      const invalid = { blockId: '12345678', base: null, strictness: 'gate', unknown: true };
      const decoded = yield* Effect.result(toolArguments(doors.native.enforce_rule!, 'enforce_rule', invalid));
      if (Result.isSuccess(decoded)) return yield* Effect.die('unknown input reached native dispatch');
      expect(yield* http('enforce_rule', invalid)).toMatchObject({
        class: 'refusal',
        code: decoded.failure.code,
        unblock: decoded.failure.unblock ?? [],
      });
      expect(decoded.failure.detail).toMatch(/unknown/u);

      const parentId = ((yield* world.op('list_root_blocks', {}, `project=${project}`)).body as { blocks: { name: string }[] }).blocks[0]!
        .name;
      const written = [
        yield* answerOf(yield* http('create_block', { title: 'written over http', parentId })),
        yield* answerOf(yield* native('create_block', { title: 'written natively', parentId })),
      ];
      const byOperator = yield* world.op('create_block', { title: 'written by the operator', parentId }, `project=${project}`);
      const names = [...written, byOperator.body].map((answer) => (answer as { block: { name: string } }).block.name);
      const found = yield* answerOf(yield* http('read_block', { blockIds: names }));
      const blocks = (found as { reads: readonly { projectId: number; author: number | null }[] }).reads;
      expect(blocks.map((block) => block.projectId)).toEqual([project, project, project]);
      const [overHttp, natively, operator] = blocks;
      expect(overHttp?.author).not.toBeNull();
      expect(natively?.author).toBe(overHttp?.author as number);
      expect(operator?.author).toBeNull();
    }),
  );
});
