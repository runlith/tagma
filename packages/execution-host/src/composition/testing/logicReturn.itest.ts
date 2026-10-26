import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactManifest } from '@runlith/executions/protocol/artifact';
import { bootPath } from '@runlith/executions/protocol/boot';
import type { PrepareAnswer } from '@runlith/executions/protocol/runtime';
import { PIPES } from '../../holder/testing/Adapter';
import { spawned } from '../../hostFixture';
import { bundledStand, type Stand } from './bundled';
import { driving, run, type Started } from './standDriver';

let directory: string;
const QUIET = { program: '/bin/sleep', args: ['50'] };

let stand: Stand;
const facts: Record<string, unknown> = {};
const children: Started[] = [];

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const standingDigest = () =>
  (JSON.parse(readFileSync(join(directory, 'bundle', 'artifact.json'), 'utf8')) as ArtifactManifest).identity.digest;
const nextDigest = () =>
  (JSON.parse(readFileSync(join(directory, 'bundle.next', 'artifact.json'), 'utf8')) as ArtifactManifest).identity.digest;
const argsOf = async (pid: number) => (await spawned(['/bin/ps', '-o', 'args=', '-p', String(pid)])).stdout.trim();
const aheadRows = () => {
  const store = new Database(join(directory, 'executions.sqlite'), { readonly: true });
  try {
    return (store.query("select count(*) as rows from __drizzle_migrations where hash = 'ahead'").get() as { rows: number }).rows;
  } finally {
    store.close();
  }
};

beforeAll(async () => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'logic-return-')));
  stand = await bundledStand(directory, 1);
  const drive = driving(stand);
  children.push(await drive.start(PIPES, QUIET));
  const pids = async () => Promise.all(children.map((one) => drive.pidOf(one.ref)));

  const proven = standingDigest();
  await stand.offer({ build: 'ahead', logic: 'store-ahead' });
  const ahead = nextDigest();
  facts.aheadPrepared = await stand.prepare();
  const fix = await stand.stage({ build: 'fixed', logic: 'store-repair' });
  await stand.away();
  await stand.heard('the logic of the activated bundle never came up; the prior bundle stands again');
  await stand.heard('StoreAhead');
  facts.ahead = { proven, ahead, standing: standingDigest(), next: nextDigest(), rows: aheadRows(), holder: alive(stand.holderPid) };
  const serving = stand.served();
  fix();
  const fixed = nextDigest();
  await serving;
  drive.forgetLanes();
  facts.fixed = {
    fixed,
    standing: standingDigest(),
    boot: (await argsOf(await stand.logicPid())).includes(bootPath(directory, fixed)),
    phase: (await run(stand.client.status())).phase,
    pids: await pids(),
  };
  await stand.offer({ build: 'ahead', logic: 'store-ahead' });
  facts.offeredAgain = await stand.prepare();
}, 58_000);

afterAll(async () => {
  await stand?.dispose();
  for (const one of children) if (alive(one.pid)) process.kill(one.pid, 'SIGKILL');
});

describe('a holder whose activated logic never comes up', () => {
  it('returns the proven bundle, keeps its logic off a newer store, and serves the fix with its children alive', () => {
    expect((facts.aheadPrepared as PrepareAnswer)._tag).toBe('Prepared');
    const ahead = facts.ahead as { proven: string; ahead: string; standing: string; next: string; rows: number; holder: boolean };
    expect(ahead.standing).toBe(ahead.proven);
    expect(ahead.next).toBe(ahead.ahead);
    expect(ahead.rows).toBe(1);
    expect(ahead.holder).toBe(true);
    const fixed = facts.fixed as { fixed: string; standing: string; boot: boolean; phase: string; pids: number[] };
    expect(fixed.standing).toBe(fixed.fixed);
    expect(fixed.boot).toBe(true);
    expect(fixed.phase).toBe('open');
    expect(fixed.pids).toEqual(children.map((one) => one.pid));
    const again = facts.offeredAgain as PrepareAnswer;
    expect(again._tag === 'Unprepared' && again.reason).toBe('holder');
  });
});
