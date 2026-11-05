import { join } from 'node:path';
import { Effect, Result, Schema } from 'effect';
import { knownAnswer } from '../platform/contract/wire/operation.js';
import { PROVIDER_OPERATIONS } from '../providers/contract/wire/operations.js';
import type { Trial } from '../cut/platform.js';
import {
  cli,
  closed,
  held,
  installedFrom,
  observedAfresh,
  openWorld,
  said,
  serving,
  type Seen,
  unpacked,
  updated,
  whisperRuns,
} from './world.js';

const decodeSignIns = Schema.decodeUnknownResult(Schema.fromJsonString(knownAnswer(PROVIDER_OPERATIONS.read_sign_in.answer)));

export const transitionTrouble = (seen: Seen, release: string, terminals: boolean): string | null => {
  const troubles = [
    seen.serving === release ? null : `its server answers as ${seen.serving ?? 'nothing'}, not ${release}`,
    seen.current === release ? null : `current names ${seen.current ?? 'nothing'}, not ${release}`,
    seen.kept === release
      ? null
      : `its release keeps ${seen.kept === null ? 'no copy of its application' : `an application of ${seen.kept}`}`,
    seen.sound.present ? null : `its sound is absent: ${seen.sound.reason ?? 'no reason given'}`,
    seen.whisper.present ? null : `its Whisper engine is absent: ${seen.whisper.reason ?? 'no reason given'}`,
    !seen.sound.present || (seen.copy !== null && seen.sound.helper?.startsWith(`${seen.copy}/`) === true)
      ? null
      : `its sound answers from ${seen.sound.helper ?? 'no helper process of its own'}, not from ${seen.copy ?? 'a copy its release keeps'}`,
    !terminals || seen.terminals !== null ? null : 'the terminals opened before the update were not read',
    seen.terminals === null || seen.terminals.pipes === 'running'
      ? null
      : `the pipes terminal opened before the update reads ${seen.terminals.pipes}`,
    seen.terminals === null || seen.terminals.pty === 'running'
      ? null
      : `the pty terminal opened before the update reads ${seen.terminals.pty}`,
    seen.terminals?.beats.trouble ?? null,
  ].filter((one) => one !== null);
  return troubles.length === 0 ? null : troubles.join('; ');
};

export const trialStart = ({
  channel,
  archive,
  offer,
  predecessor,
  labels,
  scratch,
  log,
  processes,
}: Trial): Effect.Effect<string | null> =>
  Effect.promise(async (): Promise<string | null> => {
    const opened = await openWorld(channel, scratch, processes);
    if (Result.isFailure(opened)) return opened.failure;
    const world = opened.success;
    try {
      const next = await unpacked(world, archive, join(world.dir, 'next'));
      if (Result.isFailure(next)) return next.failure;
      const before = predecessor === null ? next : await unpacked(world, predecessor, join(world.dir, 'before'));
      if (Result.isFailure(before)) return `the release before it: ${before.failure}`;
      const installed = await installedFrom(world, before.success);
      log(
        `install-from of ${predecessor === null ? offer.release : predecessor} in ${world.dir}: exited ${installed.code}\n${installed.out}${installed.err}`,
      );
      if (installed.code !== 0) return `install-from refused the release: ${said(installed)}`;
      const answered = await serving(world);
      if (answered !== null) return answered;
      const terminals = await held(world);
      if (Result.isFailure(terminals)) return terminals.failure;
      if (predecessor !== null) {
        const update = await updated(world, offer);
        if (update !== null) return update;
      }
      const seen = await observedAfresh(world, terminals.success);
      log(`after ${predecessor === null ? 'its install' : `the update from ${predecessor}`}: ${JSON.stringify(seen)}`);
      const transition = transitionTrouble(seen, offer.release, true);
      if (transition !== null) return transition;
      const engine = await whisperRuns(world);
      log(`whisper engine: ${engine ?? 'runs'}`);
      if (engine !== null) return engine;
      const read = await cli(world, 'op', 'read_sign_in', '--json', '{}');
      log(`read_sign_in: exited ${read.code}\n${read.out}${read.err}`);
      if (read.code !== 0) return `its provider registry could not be read: ${said(read)}`;
      const signIns = decodeSignIns(read.out);
      if (signIns._tag === 'Failure') return `its provider registry answered outside its shape: ${signIns.failure.message}`;
      const providers = Object.keys(signIns.success.providers);
      if (providers.length === 0) return 'its provider registry answered no provider at all, so what it knows is unproved';
      log(`providers its registry knows: ${providers.join(', ')}`);
      const known = labels.filter((label) => providers.some((provider) => provider.toLowerCase() === label.text.toLowerCase()));
      return known.length === 0
        ? null
        : `its running server knows the providers ${known.map((label) => `${label.text} (declared by ${label.by})`).join(', ')}`;
    } finally {
      log(await closed(world));
    }
  });
