import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import type { PluginFaced } from '../platform/contract/service/contribution.js';
import { PluginPointRefused } from './contract/service/points.js';
import { pluginPoints } from './testing/points.js';

const face = <W>(name: string, schema: Schema.Codec<W, unknown>): PluginFaced<W> => ({
  id: `test/${name}`,
  plugin: { name, title: name, schema },
});

const HELD = face('held', Schema.Array(Schema.String));
const SOLE = face('sole', Schema.String);
const BOARD = { id: 'board', title: 'Board', root: '/board', data: '/board-data' };
const CALLER = { call: () => Effect.die('no tool is called'), callAdmitted: () => Effect.die('no tool is called') };

it.effect('a republish withdraws what it replaces before registering, and a held contribution never stands empty meanwhile', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const points = pluginPoints();
      const held = yield* points.hold(HELD);
      const told: (readonly string[] | undefined)[] = [];
      held.changed((plugin) => told.push(held.of(plugin)?.value));
      let sole = null as string | null;
      const seen: (readonly string[] | undefined)[] = [];
      yield* points.declare(SOLE, ({ value }) =>
        Effect.suspend(() => {
          if (sole !== null) return Effect.fail(new PluginPointRefused({ point: 'sole', reason: `${sole} still stands` }));
          seen.push(held.of('board')?.value);
          sole = value;
          return Effect.succeed(() => {
            sole = null;
          });
        }),
      );
      const first = yield* points.publish(BOARD, { sole: 'one', held: ['a'] }, CALLER);
      told.length = 0;
      seen.length = 0;
      yield* points.publish(BOARD, { sole: 'two', held: ['b'] }, CALLER, first);
      expect(seen).toEqual([['a']]);
      expect(told).toEqual([['b']]);
      expect(sole).toBe('two');
    }),
  ),
);
