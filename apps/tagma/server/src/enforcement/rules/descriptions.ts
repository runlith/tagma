import { Effect } from 'effect';
import { type ConfigVersion, Configs } from '../../config/contract/service/configs.js';
import { CONFIG_FILE, type Config } from '../../config/contract/wire/config.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type Check, checkOf, type Descriptions, type MapReading } from '../contract/wire/document.js';

export const descriptionsAt = Effect.fn('enforcement.descriptionsAt')(function* (version: ConfigVersion) {
  return yield* (yield* Configs).read(version).pipe(
    Effect.map((config): Descriptions => ({ config })),
    Effect.catchTags({
      GateRefusal: (refused) => Effect.succeed<Descriptions>({ unread: `${refused.code}: ${refused.reason}` }),
      OwnGitFailed: (failed) => Effect.succeed<Descriptions>({ unread: `git could not read it: ${failed.message}` }),
    }),
  );
});

export const configAt = Effect.fn('enforcement.configAt')(function* (version: ConfigVersion) {
  return yield* (yield* Configs)
    .read(version)
    .pipe(
      Effect.catchTag('OwnGitFailed', (failed) =>
        Effect.fail(
          new GateRefusal('git-unavailable', `${CONFIG_FILE} at ${version.tree} could not be read: ${failed.message}`, [
            'read what git said and clear it, then run the act again',
          ]),
        ),
      ),
    );
});

const unknownIn = (config: Config | null, version: ConfigVersion, key: string) =>
  new GateRefusal(
    'inspection-unknown',
    `${config === null ? `the version at ${version.tree} carries no ${CONFIG_FILE}` : `${CONFIG_FILE} at ${version.tree} declares no inspection ${key}`}, so ${key} names nothing to judge by`,
    [
      `land ${CONFIG_FILE} with the inspection ${key} first: enforce_rule reads the key at HEAD, the version it measures`,
      `check_rules with \`inspection: "${key}"\` over the change runs it from this session's uncommitted ${CONFIG_FILE} before it lands`,
    ],
  );

export const inspectionIn = (
  config: Config | null,
  version: ConfigVersion,
  key: string,
  reading: MapReading,
): Effect.Effect<Check, GateRefusal<'inspection-unknown'>> =>
  config === null || !config.inspections.has(key)
    ? Effect.fail(unknownIn(config, version, key))
    : Effect.succeed(checkOf(key, { config }, reading));

export const inspectionAt = Effect.fn('enforcement.inspectionAt')(function* (version: ConfigVersion, key: string, reading: MapReading) {
  return yield* inspectionIn(yield* configAt(version), version, key, reading);
});
