import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Duration, Effect, Fiber, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { CallPlace } from '../../platform/contract/service/place.js';
import { settingKey, SETTABLE_SCOPES } from '../../platform/contract/wire/setting.js';
import { Settings } from '../../settings/contract/service/values.js';
import { SettingChanges } from '../../settings/contract/service/changes.js';
import { liveOf } from '../../settings/live.js';
import type { SettingLayer } from '../../settings/resolution.js';
import { DeclaredCapabilities } from '../contract/service/capabilities.js';
import { CHANGE_WAIT_MS } from '../contract/wire/operations/capabilities.js';
import { CAPABILITY_PAIRS } from './operations.js';

const enabled = settingKey({
  id: 'fixture.enabled',
  order: 1,
  title: 'Fixture',
  description: 'Fixture',
  schema: Schema.Boolean,
  fallback: false,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});
const project: SettingLayer = { scope: 'project', values: new Map([[enabled.id, true]]), declined: new Set(), writers: new Map() };

const fixture = Effect.fnUntraced(function* (live: ReturnType<typeof liveOf>) {
  const context = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(Settings, { live: live.live, held: live.held }),
      Layer.succeed(SettingChanges, live.settingChanges),
      Layer.succeed(DeclaredCapabilities, [
        { owner: 'fixture', declaration: { id: 'fixture', description: 'Fixture', sections: [], enabledBy: enabled } },
      ]),
    ),
  );
  const read = (projectId: number | null, after?: string) =>
    CAPABILITY_PAIRS.read_capability_settings.body
      .execute({ after }, undefined, { actor: { kind: 'operator' }, files: null })
      .pipe(
        Effect.provideContext(context),
        Effect.provideService(CallPlace, projectId === null ? null : { projectId, checkout: null, branch: null }),
      );
  return read;
});

it.effect('a user write during the initial live read reaches an outside-project MCP watch with its previous revision', () =>
  Effect.gen(function* () {
    let suspended = false;
    const reading = yield* Deferred.make<void>();
    const initial = yield* Deferred.make<SettingLayer[]>();
    const live = liveOf(() =>
      suspended ? Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(initial)) : Effect.succeed([]),
    );
    const read = yield* fixture(live);
    const before = yield* read(null);
    suspended = true;
    const watching = yield* Effect.forkChild(read(null, before.revision).pipe(Effect.timeout('1 second')));
    yield* Deferred.await(reading);
    live.publish(enabled.id, 'user', null, 'true', false);
    yield* live.settingChanges.publish({ key: enabled.id, scope: 'user', projectId: null });
    yield* Deferred.succeed(initial, []);
    yield* TestClock.adjust('1 second');
    expect((yield* Fiber.join(watching)).disabled).toEqual([]);
  }),
);

it.effect('a waiting reader that sees no change answers the reading as it stands once the change wait ends', () =>
  Effect.gen(function* () {
    const read = yield* fixture(liveOf(() => Effect.succeed([])));
    const standing = yield* read(null);
    const waiting = yield* Effect.forkChild(read(null, standing.revision));
    yield* TestClock.adjust(Duration.millis(CHANGE_WAIT_MS));
    expect(yield* Fiber.join(waiting)).toEqual(standing);
  }),
);

it.effect(
  'capability readings use the operator layer outside a project, and a waiting project reader answers only an effective change',
  () =>
    Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      const initial = yield* Deferred.make<SettingLayer[]>();
      const live = liveOf((projectId) =>
        projectId === undefined ? Effect.succeed([]) : Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(initial)),
      );
      const read = yield* fixture(live);
      expect((yield* read(null)).disabled).toEqual(['fixture']);
      const acquiring = yield* Effect.forkChild(read(1));
      yield* Deferred.await(reading);
      live.publish(enabled.id, 'project', 1, 'false', false);
      yield* live.settingChanges.publish({ key: enabled.id, scope: 'project', projectId: 1 });
      yield* Deferred.succeed(initial, [project]);
      expect((yield* Fiber.join(acquiring)).disabled).toEqual(['fixture']);
      live.publish(enabled.id, 'project', 1, 'true', false);
      yield* live.settingChanges.publish({ key: enabled.id, scope: 'project', projectId: 1 });
      const standing = yield* read(1);
      expect(standing.disabled).toEqual([]);
      const waiting = yield* Effect.forkChild(read(1, standing.revision));
      yield* Effect.yieldNow;
      live.publish(enabled.id, 'user', null, 'false', false);
      yield* live.settingChanges.publish({ key: enabled.id, scope: 'user', projectId: null });
      live.publish(enabled.id, 'project', 1, 'false', false);
      yield* live.settingChanges.publish({ key: enabled.id, scope: 'project', projectId: 1 });
      expect((yield* Fiber.join(waiting)).disabled).toEqual(['fixture']);
    }),
);
