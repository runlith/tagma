import { expect } from 'bun:test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { it } from '@runlith/effect-test';
import { cursorRunner } from '@runlith/adapter-cursor/runner';
import { Effect } from 'effect';
import { Command } from 'effect/cli';
import { CurrentInvocation, Invocation } from '../../platform/cli/verb.js';
import { harnessRun } from './harnessRun.js';
import type { ServerCli } from './server.js';

const server: ServerCli = { ask: () => Effect.die('a fresh ask uses no hosted door'), here: (at) => ({ cwd: at.cwd }) };
const at = new Invocation({}, '/work', () => new Response('').body!, 'tagma');

it.effect('a fresh ask resolves its builtin runner declaration and preserves the runner’s login refusal', () =>
  Effect.gen(function* () {
    const command = harnessRun(server, new Map([['quill', async () => cursorRunner]]));
    const refused = yield* Effect.flip(
      Command.runWith(command, { version: 'test' })(['quill', '--ask', '--model', 'composer-test']).pipe(
        Effect.provideService(CurrentInvocation, at),
        Effect.provide(BunServices.layer),
      ),
    );
    expect(refused).toMatchObject({ _tag: 'AgentFault', code: -32000 });
  }),
);
