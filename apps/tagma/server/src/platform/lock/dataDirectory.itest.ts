import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { spawnedEffect } from '../testing/spawn.js';
import { DataDirectoryConflict, lockDataDirectory } from './dataDirectory.js';
import { dataDirectoryHolder } from './holder.js';

const SERVER = new URL('../../../', import.meta.url).pathname;
const LOCK = new URL('./dataDirectory.ts', import.meta.url).href;

const dataDirectory = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'tagma-lock-'))),
  (data) => Effect.sync(() => rmSync(data, { recursive: true, force: true })),
);

const contender = (data: string, then: string) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(
        [
          process.execPath,
          '--eval',
          `import { Effect } from 'effect';
   import { lockDataDirectory } from ${JSON.stringify(LOCK)};
   const taken = await Effect.runPromise(Effect.result(lockDataDirectory(${JSON.stringify(data)})));
   console.log(taken._tag === 'Success' ? 'locked' : taken.failure._tag);
   ${then}`,
        ],
        { cwd: SERVER, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' },
      ),
    ),
    (child) => Effect.sync(() => child.kill('SIGKILL')),
  );

const firstLine = (child: Bun.Subprocess<'ignore', 'pipe', 'inherit'>) =>
  Effect.promise(async () => {
    const reader = child.stdout.getReader();
    let text = '';
    while (!text.includes('\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    return text.trim();
  });

const attempt = (data: string) => Effect.result(lockDataDirectory(data));

describe('the data-directory lock', () => {
  it.live('a live holder is refused by name, and its death hands the directory over at once', () =>
    Effect.gen(function* () {
      const data = yield* dataDirectory;
      const holder = yield* contender(data, 'await Bun.sleep(30_000);');
      expect(yield* firstLine(holder)).toBe('locked');

      const refused = yield* attempt(data);
      expect(refused._tag).toBe('Failure');
      if (refused._tag === 'Failure') {
        expect(refused.failure).toBeInstanceOf(DataDirectoryConflict);
        expect(refused.failure._tag === 'DataDirectoryConflict' ? refused.failure.holder : null).toBe(holder.pid);
      }

      holder.kill('SIGKILL');
      yield* Effect.promise(() => holder.exited);
      const taken = yield* attempt(data);
      expect(taken._tag).toBe('Success');
      if (taken._tag === 'Success') yield* taken.success.release;
    }),
  );

  it.live('two starters racing over a holder that died leave exactly one winner', () =>
    Effect.gen(function* () {
      const data = yield* dataDirectory;
      const dead = (yield* spawnedEffect(['true'])).pid;
      writeFileSync(join(data, 'server.lock'), `${dead}\n`);
      const racing = [yield* contender(data, 'await Bun.sleep(30_000);'), yield* contender(data, 'await Bun.sleep(30_000);')];

      const said = yield* Effect.all(racing.map(firstLine), { concurrency: 'unbounded' });

      expect(said.toSorted()).toEqual(['DataDirectoryConflict', 'locked']);
    }),
  );

  it.live('a process the holder started keeps nothing locked once the holder is gone', () =>
    Effect.gen(function* () {
      const data = yield* dataDirectory;
      const holder = yield* contender(
        data,
        `const kept = Bun.spawn(['sleep', '5'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }); kept.unref(); console.log(kept.pid); process.exit(0);`,
      );
      const [said, kept] = (yield* Effect.promise(() => new Response(holder.stdout).text())).trim().split('\n');
      expect(said).toBe('locked');
      yield* Effect.addFinalizer(() => Effect.sync(() => process.kill(Number(kept), 'SIGKILL')));
      yield* Effect.promise(() => holder.exited);

      const taken = yield* attempt(data);
      expect(taken._tag).toBe('Success');
      if (taken._tag === 'Success') yield* taken.success.release;
    }),
  );

  it.live("a live pre-lock claim refuses, and a dead one is replaced by the holder's own claim until it releases", () =>
    Effect.gen(function* () {
      const data = yield* dataDirectory;
      writeFileSync(join(data, 'server.pid'), '1\n');
      const refused = yield* attempt(data);
      expect(refused._tag === 'Failure' && refused.failure._tag === 'DataDirectoryConflict' ? refused.failure.holder : null).toBe(1);

      const dead = (yield* spawnedEffect(['true'])).pid;
      writeFileSync(join(data, 'server.pid'), `${dead}\n`);
      const taken = yield* attempt(data);
      expect(taken._tag).toBe('Success');
      expect(readFileSync(join(data, 'server.pid'), 'utf8').trim()).toBe(String(process.pid));
      if (taken._tag === 'Success') yield* taken.success.release;
      expect(existsSync(join(data, 'server.pid'))).toBe(false);
    }),
  );

  it.live('a claim left by a holder that died uncleanly does not refuse the next start, even when its pid is alive again', () =>
    Effect.gen(function* () {
      const data = yield* dataDirectory;
      const reused = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.spawn(['sleep', '5'])),
        (child) => Effect.sync(() => child.kill()),
      );
      writeFileSync(join(data, 'server.lock'), `${reused.pid}\n`);
      writeFileSync(join(data, 'server.pid'), `${reused.pid}\n`);
      const taken = yield* attempt(data);
      expect(taken._tag).toBe('Success');
      expect(readFileSync(join(data, 'server.pid'), 'utf8').trim()).toBe(String(process.pid));
      if (taken._tag === 'Success') yield* taken.success.release;
    }),
  );

  it.live('the holder is named while the lock stands and nobody is once it is released', () =>
    Effect.gen(function* () {
      const data = yield* dataDirectory;
      const taken = yield* attempt(data);
      expect(taken._tag).toBe('Success');
      expect(dataDirectoryHolder(data)).toBe(process.pid);
      if (taken._tag === 'Success') yield* taken.success.release;
      expect(dataDirectoryHolder(data)).toBeNull();
      const again = yield* attempt(data);
      expect(again._tag).toBe('Success');
      if (again._tag === 'Success') yield* again.success.release;
    }),
  );
});
