import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactManifest } from '@runlith/executions/protocol/artifact';
import type { PrepareAnswer } from '@runlith/executions/protocol/runtime';
import { PIPES } from '../../holder/testing/Adapter';
import { bundledStand, EXTRA_MIGRATION, type Stand } from './bundled';
import { driving, type Started } from './standDriver';

let directory: string;
let stand: Stand;
let child: Started | undefined;
const facts: Record<string, unknown> = {};

const ledger = (): readonly string[] => {
  const store = new Database(join(directory, 'executions.sqlite'), { readonly: true });
  try {
    return store
      .query<{ name: string }, []>('select name from __drizzle_migrations order by created_at, id')
      .all()
      .map((row) => row.name);
  } finally {
    store.close();
  }
};

const digestAt = (bundle: string) =>
  (JSON.parse(readFileSync(join(directory, bundle, 'artifact.json'), 'utf8')) as ArtifactManifest).identity.digest;

beforeAll(async () => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'store-return-')));
  stand = await bundledStand(directory, 1, 'extra');
  const drive = driving(stand);
  child = await drive.start(PIPES, { program: '/bin/cat', args: [] });
  const applied = ledger();
  await stand.offer({ build: 'shipped' });
  const offered = digestAt('bundle.next');
  facts.prepared = await stand.change();
  drive.forgetLanes();
  facts.after = {
    applied: applied.includes(EXTRA_MIGRATION),
    ledger: ledger(),
    expected: applied.filter((name) => name !== EXTRA_MIGRATION),
    serving: digestAt('bundle') === offered,
    child: await drive.pidOf(child.ref),
  };
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

afterAll(async () => {
  await stand?.dispose();
  if (child !== undefined && alive(child.pid)) process.kill(child.pid, 'SIGKILL');
});

describe('a logic yielding to a bundle whose migrations lack one its store applied', () => {
  it('prepares it, returns the store onto its chain at departure, and the new logic serves the store with the execution alive', () => {
    expect((facts.prepared as PrepareAnswer)._tag).toBe('Prepared');
    const after = facts.after as {
      applied: boolean;
      ledger: readonly string[];
      expected: readonly string[];
      serving: boolean;
      child: number;
    };
    expect(after.applied).toBe(true);
    expect(after.ledger).toEqual(after.expected);
    expect(after.serving).toBe(true);
    expect(after.child).toBe(child!.pid);
  });
});
