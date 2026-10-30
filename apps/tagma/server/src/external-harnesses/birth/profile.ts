import { Effect, type FileSystem, Schema } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { harnessProfile, type HarnessProfile } from '../settings.js';
import type { HarnessTransportOffer } from '../contract/service/table.js';

export const homeVariable = (adapter: HarnessAdapter): string | null => adapter.hooks?.user?.homeEnv ?? null;

export const profileOf = (
  adapter: HarnessAdapter,
  asked: HarnessProfile | undefined,
  offer: HarnessTransportOffer,
): Effect.Effect<HarnessProfile, GateRefusal> => {
  if (asked === undefined || (asked.home === undefined && asked.plain !== true && asked.permissionMode === undefined))
    return Effect.succeed({});
  const name = adapter.harness;
  if (offer.transport !== 'terminal') {
    return new GateRefusal(
      'profile-transport',
      `${adapter.label} is born on ${offer.transport} in this project, and its harness profile applies to the terminal transport.`,
      [`set threads.harnessTransport.${name} to terminal`, `clear threads.harnessProfile.${name}`],
    );
  }
  if (asked.home !== undefined && homeVariable(adapter) === null) {
    return new GateRefusal('profile-unsupported', `${adapter.label} names no configuration folder Tagma can launch it with.`, [
      `clear threads.harnessProfile.${name}.home`,
    ]);
  }
  if (asked.plain === true && asked.home === undefined) {
    return new GateRefusal(
      'profile-home',
      `A plain ${adapter.label} thread needs a configuration folder of its own: the default one carries the hooks Tagma installs for every ${adapter.label}, and they speak to the agent.`,
      [`set threads.harnessProfile.${name}.home to a folder Tagma installs nothing into`],
    );
  }
  if (asked.plain === true && adapter.metadata?.ends?.located !== 'launch') {
    return new GateRefusal(
      'profile-unsupported',
      `${adapter.label} names its transcript only once it reports its session, so a plain thread of it could not see its turns end.`,
      [`clear threads.harnessProfile.${name}.plain`],
    );
  }
  const modes = offer.launch.permissionModes;
  if (asked.permissionMode !== undefined && (modes === undefined || !modes.values.includes(asked.permissionMode))) {
    return new GateRefusal(
      'profile-permission',
      modes === undefined
        ? `${adapter.label} is launched in no permission mode Tagma can name.`
        : `${adapter.label} has no permission mode ${asked.permissionMode}.`,
      modes === undefined
        ? [`clear threads.harnessProfile.${name}.permissionMode`]
        : [`set threads.harnessProfile.${name}.permissionMode to one of: ${modes.values.join(', ')}`],
    );
  }
  return Effect.succeed(asked);
};

const setupRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

export const homeSetUp = Effect.fnUntraced(function* (files: FileSystem.FileSystem, adapter: HarnessAdapter, profile: HarnessProfile) {
  const name = adapter.harness;
  const setup = adapter.setup;
  if (profile.home === undefined || setup === undefined) return;
  const path = `${profile.home}/${setup.file}`;
  const read = yield* Effect.result(files.readFileString(path));
  if (read._tag === 'Failure' && read.failure.reason._tag !== 'NotFound') {
    return yield* new GateRefusal(
      'profile-home',
      `${path} could not be read to tell whether ${adapter.label} finished its setup there: ${read.failure.message}`,
      [`make ${profile.home} readable to Tagma`, `clear threads.harnessProfile.${name}.home`],
    );
  }
  const record = read._tag === 'Success' ? yield* Effect.result(setupRecord(read.success)) : null;
  if (record !== null && record._tag === 'Success' && record.success[setup.done] === true) return;
  return yield* new GateRefusal(
    'profile-home-setup',
    `${adapter.label} has not finished its first-run setup in ${profile.home}: its theme and login screens would stand in the thread's terminal before the task.`,
    [`run ${adapter.binary} once with ${homeVariable(adapter) ?? 'its configuration folder'}=${profile.home}, finish its setup and log in`],
  );
});

export const birthProfile = (
  settings: Settings['Service'],
  adapter: HarnessAdapter,
  projectId: number,
  offer: HarnessTransportOffer,
): Effect.Effect<HarnessProfile, GateRefusal | StoreFailure> =>
  Effect.flatMap(settings.value(harnessProfile, projectId), (asked) => profileOf(adapter, asked[adapter.harness], offer));
