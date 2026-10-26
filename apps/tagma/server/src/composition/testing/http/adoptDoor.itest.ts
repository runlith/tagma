import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { Cause, Context, Effect, FileSystem, Queue } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { keyedSessions } from '../../../external-harnesses/testing/sessions.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { mintShellKey } from '../../../platform/credentials/grants.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { makeDoorWorld } from '../doorFixture.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';

const ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..', '..');
const EXECUTION_HOST = join(ROOT, 'packages', 'execution-host');
const LIBRARY = join(EXECUTION_HOST, 'native', 'target', 'release', 'libexecution_platform.dylib');
const CLI = join(import.meta.dir, '..', '..', 'entries', 'cli.ts');

describe.skipIf(!existsSync(LIBRARY))('the adopt door over HTTP', () => {
  it.live(
    'a hook under an operator shell is born as a thread of the project its directory names, and a settled refusal is asked once',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const world = yield* makeDoorWorld();
        const asked: string[] = [];
        const served = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: '127.0.0.1',
              port: 0,
              fetch(request) {
                const url = new URL(request.url);
                if (url.pathname === '/api/op/adopt_harness_session') asked.push(url.searchParams.get('cwd') ?? '');
                return world.app(request, world.routed);
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        );
        const project = yield* world.directory('adopt-project');
        const other = yield* world.directory('adopt-other');
        const scratch = yield* world.directory('adopt-scratch');
        for (const cwd of [project, other]) yield* spawnedEffect(['git', 'init', '-q', '-b', 'main'], { cwd });
        const projectId = yield* world.stealthProject(project);
        const otherId = yield* world.stealthProject(other);
        const coverage = Context.get(world.runtime.workspace, Coverage);
        yield* coverage.cover(projectId);
        yield* coverage.cover(otherId);
        const key = `door-${crypto.randomUUID()}`;
        const foreign = `door-foreign-${crypto.randomUUID()}`;
        const events = {
          born: { hook_event_name: 'SessionStart', session_id: key, cwd: project },
          first: { hook_event_name: 'SessionStart', session_id: foreign, cwd: other },
          later: { hook_event_name: 'PreToolUse', session_id: foreign, tool_name: 'Edit', cwd: other },
        };
        for (const [name, event] of Object.entries(events))
          yield* files.writeFileString(join(scratch, `${name}.json`), JSON.stringify(event));
        const hook = (name: string, verb: string) =>
          `sh -c 'TAGMA_SERVER_URL=http://127.0.0.1:${served.port} TMPDIR=${scratch} bun ${CLI} hook ${verb} --harness claude-code < ${join(scratch, `${name}.json`)}; true'`;
        const done = join(scratch, 'done');
        const script = [
          'set -m',
          hook('born', 'session-start'),
          hook('first', 'session-start'),
          hook('later', 'pre-tool-use'),
          `touch ${done}`,
          'sleep 600',
        ].join('\n');
        const changed = yield* Queue.unbounded<void, Error>();
        yield* Effect.acquireRelease(
          Effect.try(() =>
            watch(scratch, () => Queue.offerUnsafe(changed, undefined)).on('error', (error) =>
              Queue.failCauseUnsafe(changed, Cause.fail(error)),
            ),
          ),
          (observer) => Effect.sync(() => observer.close()),
        );
        const started = yield* Effect.gen(function* () {
          const terminals = yield* Terminals;
          const operator = principalOf({ _tag: 'Operator' });
          const target = yield* terminals.target({ projectId, kind: 'host', cwd: project });
          return yield* terminals.start({
            actor: { _tag: 'Operator' },
            operationId: HostRequestKey.make(`adopt-door-${crypto.randomUUID()}`),
            target,
            targetKey: targetKeyOf(targetIdentity(target, operator, operator)),
            program: '/bin/bash',
            args: ['--norc', '--noprofile', '-c', script],
            transport: 'pty',
            lifetime: 'held',
            geometry: { rows: 40, columns: 120 },
            shellKey: mintShellKey(),
          });
        }).pipe(Effect.scoped, Effect.provide(world.runtime.owners));
        expect(started._tag).toBe('Started');
        while (!(yield* files.exists(done))) yield* Queue.take(changed);
        const keyed = (sessionKey: string) => Effect.flatMap(MachineStore, (store) => keyedSessions(store.db, sessionKey));
        const bornHere = yield* keyed(key).pipe(Effect.provide(world.runtime.graph));
        expect(bornHere.map((row) => row.projectId)).toEqual([projectId]);
        expect(bornHere[0]?.facet).toMatchObject({ name: 'claude-code', session: { origin: 'adopted' } });
        expect(yield* keyed(foreign).pipe(Effect.provide(world.runtime.graph))).toEqual([]);
        expect(asked).toEqual([project, other]);
      }).pipe(Effect.provide(BunFileSystem.layer)),
  );
});
