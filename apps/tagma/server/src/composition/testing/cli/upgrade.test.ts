import { expect } from 'bun:test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TestConsole } from 'effect/testing';
import { invoke } from '../../../cli/invoke.js';
import { upgrade } from '../../../installation/cli/setup.js';
import { SetupSteps } from '../../../installation/contract/service/steps.js';
import type { UpgradeEntry } from '../../../external-harnesses/installs/upgrade.js';
import { INSTALLATION_CLI as installationCli } from '../composed.js';

it.effect('upgrade reports a failed place at exit 1 and succeeds when no place failed', () =>
  Effect.gen(function* () {
    const reason = 'hooks need repair';
    let done: UpgradeEntry[] = [
      { place: 'bad', failed: reason },
      { place: 'good', skipped: 'never installed' },
    ];
    const cli = { ...installationCli, refreshInstallations: () => Effect.succeed(done) };
    const called = invoke(['upgrade'], { upgrade: async () => ({ upgrade: upgrade(cli) }) }, 'test').pipe(
      Effect.provideService(SetupSteps, SetupSteps.of({ run: () => Effect.die('this CLI projection never installs') })),
      Effect.provide(BunServices.layer),
    );
    expect(yield* called).toBe(1);
    expect((yield* TestConsole.logLines).join('\n')).toContain(`bad — failed: ${reason}`);
    done = [{ place: 'good', skipped: 'never installed' }];
    expect(yield* called).toBe(0);
  }),
);
