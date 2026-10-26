import { afterAll, beforeAll, beforeEach } from 'bun:test';
import { Session } from 'node:inspector';
import { join, relative, resolve } from 'node:path';
import { writeDiagnostic } from '@runlith/testbed/fixture';

const out = process.env['PROF_OUT'];
if (out === undefined || !out.startsWith('/')) throw new Error('profile: set PROF_OUT to an absolute directory');

const REPO = resolve(import.meta.dir, '../../../..');
const files = new Set<string>();

const session = new Session();
session.connect();

const post = <A>(method: string, params: object = {}): Promise<A> =>
  new Promise<A>((resolve, reject) =>
    session.post(method, params, (error: Error | null, result: unknown) => (error ? reject(error) : resolve(result as A))),
  );

beforeAll(async () => {
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 500 });
  await post('Profiler.start');
});

beforeEach(() => {
  files.add(relative(REPO, Bun.main));
});

afterAll(async () => {
  const { profile } = await post<{ readonly profile: unknown }>('Profiler.stop');
  const path = join(out, `worker.${process.pid}.${Date.now()}.cpuprofile`);
  writeDiagnostic(path, JSON.stringify(profile));
  writeDiagnostic(`${path}.files.json`, JSON.stringify([...files]));
  console.error(`profile: ${path} — one worker process, ${files.size} files: ${[...files].join(', ')}`);
});
