import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TestConsole } from 'effect/testing';
import * as BunServices from '@effect/platform-bun/BunServices';
import { invoke } from '../../../cli/invoke.js';
import { cliVerbs } from '../../../cli/verbs.js';
import { operationsCli } from '../../cli/operations.js';

it.effect('operation help exposes the input accepted by the server, including non-tool operations', () =>
  Effect.gen(function* () {
    const code = yield* invoke(
      ['op', 'start_turn', '--help'],
      cliVerbs(async () => operationsCli),
      operationsCli.version,
    ).pipe(Effect.provide(BunServices.layer));
    expect(code).toBe(0);
    const help = (yield* TestConsole.logLines).join('\n');
    const schema = /\n(\{[\s\S]*\})$/.exec(help)?.[1];
    expect(schema).toBeDefined();
    expect(JSON.parse(schema!)).toMatchObject({
      type: 'object',
      properties: { threadId: { type: 'string' } },
      required: expect.arrayContaining(['threadId']),
    });
  }),
);
