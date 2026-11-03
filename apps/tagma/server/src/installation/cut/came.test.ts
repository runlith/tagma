import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { Channel } from '../contract/wire/channel.js';
import { cameUp } from './came.js';
import type { BuildServer, HealthAnswer } from './port.js';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import type { StartupState } from '../contract/wire/restart.js';
import { testProcesses as processes } from '../testing/processes.js';

const channel: Channel = {
  id: 'dev',
  name: 'Tagma Test',
  bundleId: 'test',
  data: '.tagma-came-test-absent',
  port: 1,
  command: 'tagma-test',
};

const installed: HealthAnswer = {
  _tag: 'Health',
  health: { version: 'v', database: 'd', source: { cut: null, installation: { build: 'b0', digest: 'x' } } },
};

const refusing = (code: string): BuildServer => ({
  baseUrl: () => 'http://127.0.0.1:1',
  healthOrNone: () => Effect.succeed(installed),
  startup: () => Effect.succeed({ startup: null, issue: null }),
  ask: () => Effect.fail({ code, reason: 'the closure names no desktop; this server keeps running', unblock: ['read_machine_state'] }),
  boundHere: () => false,
});

it.effect('a build restart that returns on its previous installation is refused even after its failure record was replaced', () =>
  Effect.gen(function* () {
    const initial: StartupState = {
      startup: { pid: 4242, startedAt: 0, readyAt: 1, expectedMs: null, step: null, status: 'ready', phase: 'ready', failure: null },
      issue: null,
    };
    let saved = initial;
    const api: BuildServer = {
      ...refusing('unused'),
      startup: () => Effect.sync(() => saved),
      ask: (call) =>
        Effect.flatMap(CurrentInvocation, (at) =>
          call(
            {
              operations: {
                perform: () =>
                  Effect.sync(() => {
                    saved = { ...initial, startup: { ...initial.startup!, pid: 5151 } };
                    return {
                      status: 'restarting',
                      restart: {
                        leaving: { build: 'b0', digest: 'x' },
                        successor: { _tag: 'Installation', build: 'b1', digest: 'y' },
                        migrations: 0,
                      },
                    };
                  }),
              },
            },
            at,
          ),
        ),
    };
    const outcome = yield* cameUp(api, channel, 'b1');
    expect(outcome._tag).toBe('Refused');
    if (outcome._tag === 'Refused') {
      expect(outcome.lines.join(' ')).toContain('b0');
      expect(outcome.lines.join(' ')).toContain('b1');
    }
  }).pipe(Effect.provide(processes)),
);

it.effect('a server that cannot take the landed installation is to be ended by hand', () =>
  Effect.gen(function* () {
    expect((yield* cameUp(refusing('no-successor'), channel))._tag).toBe('ByHand');
    expect((yield* cameUp(refusing('successor-left'), channel))._tag).toBe('Refused');
  }).pipe(Effect.provide(processes)),
);
