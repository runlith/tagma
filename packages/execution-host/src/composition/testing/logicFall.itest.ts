import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactManifest } from '@runlith/executions/protocol/artifact';
import { bootPath, loadRefusalOf } from '@runlith/executions/protocol/boot';
import { REGISTRATION_FILE, type Registration } from '@runlith/executions/protocol/registration';
import type { PrepareAnswer } from '@runlith/executions/protocol/runtime';
import { PIPES } from '../../holder/testing/Adapter';
import { bundledStand, type Stand } from './bundled';
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
  const standing = await stand.logicPid();
  await stand.offer({ build: 'ahead', logic: 'over-store-ahead' });
  const digest = (JSON.parse(readFileSync(join(directory, 'bundle.next', 'artifact.json'), 'utf8')) as ArtifactManifest).identity.digest;
  facts.prepared = await stand.prepare();
  await stand.away();
  const refusal = loadRefusalOf(bootPath(directory, digest));
  facts.cause = await until('the load refusal of the activated logic', async () =>
    existsSync(refusal) ? readFileSync(refusal, 'utf8') : undefined,
  );
  const registered = JSON.parse(readFileSync(join(directory, REGISTRATION_FILE), 'utf8')) as Registration;
  facts.witness = { standing: registered.logic?.pid === standing, digest: registered.artifact?.identity.digest === digest };
  facts.held = { holder: alive(stand.holderPid), child: alive(child.pid) };
});

afterAll(async () => {
  await stand?.dispose();
  if (child !== undefined && alive(child.pid)) process.kill(child.pid, 'SIGKILL');
});

describe('an activated logic that refuses its store at load while its holder keeps executions', () => {
  it('publishes its cause beside its boot entry, leaves the witness of the logic before it, and the holder keeps the execution', () => {
    expect((facts.prepared as PrepareAnswer)._tag).toBe('Prepared');
    expect(facts.cause).toStartWith('StoreAhead: ');
    expect(facts.witness).toEqual({ standing: true, digest: false });
    expect(facts.held).toEqual({ holder: true, child: true });
  });
});
