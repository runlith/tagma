import { Duration, Effect, Option, Queue } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { CallPlace } from '../../platform/contract/service/place.js';
import { Settings } from '../../settings/contract/service/values.js';
import { SettingChanges } from '../../settings/contract/service/changes.js';
import { DeclaredCapabilities } from '../contract/service/capabilities.js';
import { CAPABILITY_OPERATIONS as OPS, CHANGE_WAIT_MS } from '../contract/wire/operations/capabilities.js';

export const CAPABILITY_PAIRS = {
  read_capability_settings: pair(
    OPS.read_capability_settings,
    body(OPS.read_capability_settings, {
      execute: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const projectId = (yield* CallPlace)?.projectId;
            const settings = yield* Settings;
            const changes = yield* SettingChanges;
            const declared = yield* DeclaredCapabilities;
            const gated = declared.flatMap(({ declaration }) =>
              declaration.enabledBy === undefined ? [] : [{ id: declaration.id, key: declaration.enabledBy }],
            );
            const keys = new Set(gated.map(({ key }) => key.id));
            const moved = yield* Queue.sliding<void>(1);
            const unsubscribe = changes.subscribe((event) =>
              keys.has(event.key) && (event.projectId === null || event.projectId === projectId)
                ? Queue.offer(moved, undefined).pipe(Effect.asVoid)
                : Effect.void,
            );
            yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
            const readers = yield* Effect.forEach(gated, ({ id, key }) =>
              Effect.map(projectId === undefined ? settings.live(key) : settings.held(key, projectId), (enabled) => ({ id, enabled })),
            );
            const reading = () => {
              const disabled = readers
                .filter(({ enabled }) => !enabled())
                .map(({ id }) => id)
                .sort();
              return { status: 'read' as const, revision: JSON.stringify(disabled), disabled };
            };
            const changed = Effect.gen(function* () {
              for (;;) {
                const read = reading();
                if (read.revision !== input.after) return read;
                yield* Queue.take(moved);
              }
            });
            return Option.getOrElse(yield* Effect.timeoutOption(changed, Duration.millis(CHANGE_WAIT_MS)), reading);
          }),
        ),
    }),
  ),
};
