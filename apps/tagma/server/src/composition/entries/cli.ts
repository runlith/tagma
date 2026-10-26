#!/usr/bin/env bun
import { Effect } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { invoke } from '../../cli/invoke.js';
import { holdingProcess, holdVersion } from '../../installation/closure/leases.js';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import { CHANNEL } from '@tagma/server/composition/channel';

const installed = holdingProcess(process.execPath);
if (installed !== null) holdVersion(installed);

const argv = process.argv.slice(2);

const verbsOf = () =>
  argv[0] === 'hook'
    ? import('../cli/hookVerbs.js').then(({ HOOK_VERBS }) => HOOK_VERBS)
    : import('../cli/verbs.js').then(({ TAGMA_VERBS }) => TAGMA_VERBS);

BunRuntime.runMain(
  Effect.promise(verbsOf).pipe(
    Effect.flatMap((verbs) => invoke(argv, verbs, PROGRAM_RELEASE)),
    Effect.flatMap((code) => (code === 0 ? Effect.void : Effect.sync(() => process.exit(code)))),
    Effect.provideService(InstalledChannel, CHANNEL),
    Effect.provide(BunServices.layer),
  ),
);
