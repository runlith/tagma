import { expect } from 'bun:test';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { AccountCredentials } from '../providers/contract/service/access.js';
import { ModelAsks } from '../providers/contract/service/asks.js';
import { HarnessAsides } from './contract/service/asides.js';
import { makeThreadAsks } from './asks.js';

it.effect('a thread ask without a warm copy records one refusal without inventing model or spend', () =>
  Effect.gen(function* () {
    const recording = activityRecording();
    const context = yield* Layer.build(
      Layer.mergeAll(
        Layer.succeed(ActivityLog, recording.log),
        Layer.mock(HarnessAsides, {
          of: () => undefined,
          watch: () => {
            throw new Error('a cold ask subscribes to no asides');
          },
        }),
        Layer.mock(AccountCredentials, {}),
        Layer.mock(ModelAsks, {
          resolve: () => {
            throw new Error('a cold ask resolves no model');
          },
        }),
      ),
    );
    const asks = yield* makeThreadAsks.pipe(Effect.provide(context));
    expect(yield* asks.over('cold-thread', 'Name this conversation.').pipe(Effect.flip)).toMatchObject({ code: 'not-warm' });
    expect(
      recording.activities().map((row) => ({
        thread: row.opened.thread,
        attrs: row.opened.attrs,
        outcome: row.ended?.outcome,
        reason: row.ended?.reason,
        result: row.ended?.result,
      })),
    ).toEqual([
      {
        thread: 'cold-thread',
        attrs: { kind: 'text', path: 'thread', provider: undefined, model: undefined, rung: null },
        outcome: 'refused',
        reason: 'not-warm',
        result: {},
      },
    ]);
  }),
);
