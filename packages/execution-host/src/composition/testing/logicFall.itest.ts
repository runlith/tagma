import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactManifest } from '@runlith/executions/protocol/artifact';
import { bootPath, loadRefusalOf } from '@runlith/executions/protocol/boot';
import type { PrepareAnswer } from '@runlith/executions/protocol/runtime';
import { PIPES } from '../../holder/testing/Adapter';
import { bundledStand, NOWHERE, type Stand } from './bundled';
import { driving, until, type Started } from './standDriver';

let directory: string;
let stand: Stand;
let child: Started | undefined;
const facts: Record<string, unknown> = {};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'logic-fall-')));
  stand = await bundledStand(directory, 1);
  child = await driving(stand).start(PIPES, { program: '/bin/cat', args: [] });
  await stand.offer({ build: 'unbundled', logic: 'unbundled' });
  const digest = (JSON.parse(readFileSync(join(directory, 'bundle.next', 'artifact.json'), 'utf8')) as ArtifactManifest).identity.digest;
  facts.prepared = await stand.prepare();
  await stand.away();
  const refusal = loadRefusalOf(bootPath(directory, digest));
  facts.cause = await until('the load refusal of the activated logic', async () =>
    existsSync(refusal) ? readFileSync(refusal, 'utf8') : undefined,
  );
  facts.held = { holder: alive(stand.holderPid), child: alive(child.pid) };
});

afterAll(async () => {
  await stand?.dispose();
  if (child !== undefined && alive(child.pid)) process.kill(child.pid, 'SIGKILL');
});

describe('an activated logic that refuses at load while its holder keeps executions', () => {
  it('publishes its cause beside its boot entry, and the holder keeps the execution', () => {
    expect((facts.prepared as PrepareAnswer)._tag).toBe('Prepared');
    expect(facts.cause).toBe(`BootRefused: no artifact manifest stands in ${join(directory, NOWHERE)}\n`);
    expect(facts.held).toEqual({ holder: true, child: true });
  });
});
