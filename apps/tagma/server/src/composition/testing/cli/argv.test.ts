import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TestConsole } from 'effect/testing';
import * as BunServices from '@effect/platform-bun/BunServices';
import { invoke } from '../../../cli/invoke.js';
import { cliVerbs } from '../../../cli/verbs.js';
import type { RefusalBody } from '../../../platform/contract/wire/refusal.js';
import { OPERATION_IDS, OPERATIONS } from '../catalog.js';
import { OPERATIONS_CLI as operationsCli } from '../composed.js';
import { capturedEffect } from '../captured.js';

const nowhere = { PATH: process.env.PATH, TAGMA_SERVER_URL: 'http://127.0.0.1:9' };
const tagma = (argv: readonly string[]) => capturedEffect(argv, nowhere, process.cwd());

it.effect('op lists the catalog as text or data', () =>
  Effect.gen(function* () {
    const [listed, data] = yield* Effect.all([tagma(['op']), tagma(['op', '--json'])]);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain('create_block');
    expect(data.code).toBe(0);
    expect(JSON.parse(data.out)).toContainEqual(expect.objectContaining({ id: 'create_block' }));
  }),
);

const destructiveIds = OPERATION_IDS.filter((id) => {
  const entry = OPERATIONS[id];
  return 'intent' in entry && entry.intent === 'destructive';
});
it.effect.each(destructiveIds)('%s requires destructive confirmation', (id) =>
  Effect.gen(function* () {
    const unconfirmed = yield* tagma(['op', id, '--json']);
    expect(unconfirmed.code).toBe(2);
    const refusal = JSON.parse(unconfirmed.out) as { code: string; unblock: string[] };
    expect(refusal).toMatchObject({ code: 'confirmation-required' });
    expect(refusal.unblock.join('\n')).toContain('--yes');
  }),
);

it.effect('an unknown operation is a JSON refusal at exit 2', () =>
  Effect.gen(function* () {
    const unknown = yield* tagma(['op', '--json', 'nothing_named_this']);
    expect(unknown.code).toBe(2);
    expect(JSON.parse(unknown.out)).toMatchObject({ code: 'unknown-operation' });
  }),
);

it.effect('a confirmed destructive entry answers with its operation refusal', () =>
  Effect.gen(function* () {
    const gate: RefusalBody = { code: 'body-shape', reason: 'the operation refused its input', unblock: ['supply the input'] };
    const cli = { ...operationsCli, ask: () => Effect.fail(gate) };
    const code = yield* invoke(
      ['op', 'delete_block', '--json', '--yes'],
      cliVerbs(async () => cli),
      cli.version,
    ).pipe(Effect.provide(BunServices.layer));
    expect(code).toBe(2);
    expect(JSON.parse((yield* TestConsole.logLines).join('\n'))).toEqual(gate);
  }),
);

it.effect('operation help carries the entry’s refusal codes', () =>
  Effect.gen(function* () {
    const help = yield* tagma(['op', '--json', 'create_block', '--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('tag-undeclared');
  }),
);
