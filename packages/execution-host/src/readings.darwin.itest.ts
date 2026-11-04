import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { closeSync, openSync } from 'node:fs';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, FileSystem, Layer, Schema, Stream } from 'effect';
import { processReader } from './posix/macos/processes';
import { loadLibrary } from './posix/Library';
import { HOLDER_LIBRARY } from './posix/testing/holder';
import { Processes, type ProcessReader } from './ProcessReader';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { identityMatch, type ProcessWitness } from '@runlith/executions/protocol/evidence';
import { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import { EvidenceReader, type EvidenceScans, type ScanLimits, makeEvidenceScans } from './EvidenceScans';
import { evidenceProbe, PS } from './posix/macos/evidence';
import { readStanding } from './posix/macos/standing';
import { hostSpawner } from './hostSpawner';
import { makeProcessEvidence, type ExecutionTopology, type ObservedExecution } from './ProcessEvidence';

const FIXTURE = `
const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
console.log(server.port);
`;
const LIMITS = { probeMs: 2_000, outputBytes: 1024 * 1024, errorBytes: 64 * 1024 };
const TABLE_ROWS = 802;
const SCANS: ScanLimits = { concurrency: 2, flight: 4, freshMs: 0, retained: 4, results: 2 * TABLE_ROWS };
const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'installation-1', execution: 'execution-1', incarnation: 1 });
const execution = Schema.decodeUnknownSync(ExecutionId)('execution-1');

class ListeningProcess extends Context.Service<
  ListeningProcess,
  {
    readonly witness: ProcessWitness;
    readonly port: number;
  }
>()('testing/macosReadings/ListeningProcess') {}

const fixture = Layer.effectContext(
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'execution-host-evidence-' });
    const library = yield* loadLibrary(HOLDER_LIBRARY);
    const native = yield* processReader(library);
    const child = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.spawn([process.execPath, '-e', FIXTURE], { cwd: root, stdout: 'pipe', stderr: 'ignore', env: { HOME: root } })),
      (child) =>
        Effect.andThen(
          Effect.sync(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
          }),
          Effect.promise(() => child.exited),
        ),
    );
    const identity = native.identity(child.pid);
    if (identity._tag !== 'Read')
      return yield* Effect.die(new Error(identity._tag === 'Unreadable' ? identity.detail : 'the fixture left'));
    const port = yield* Effect.promise(async () => {
      const decoder = new TextDecoder();
      let printed = '';
      for await (const chunk of child.stdout) {
        printed += decoder.decode(chunk);
        if (printed.includes('\n')) break;
      }
      return Number(printed.trim());
    });
    expect(Number.isInteger(port) && port > 0).toBe(true);
    return Context.make(Processes, native).pipe(
      Context.add(
        ListeningProcess,
        ListeningProcess.of({
          witness: { pid: child.pid, birth: identity.birth },
          port,
        }),
      ),
    );
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer), Layer.merge(hostSpawner));
const readings = Layer.effect(EvidenceReader, evidenceProbe(LIMITS)).pipe(Layer.provideMerge(fixture));

layer(readings, { excludeTestServices: true })('macOS readings', (it) => {
  describe('evidenceProbe', () => {
    it.effect('narrows native batched witnesses to the requested pids, including an empty population', () =>
      Effect.gen(function* () {
        const native = yield* Processes;
        const { witness } = yield* ListeningProcess;
        const pids = [process.pid, witness.pid];
        const rows = yield* native.scan({ _tag: 'Pids', pids });
        expect(rows.map((row) => row.pid).sort((a, b) => a - b)).toEqual(pids.sort((a, b) => a - b));
        expect(
          identityMatch(
            witness,
            rows.find((row) => row.pid === witness.pid),
          ),
        ).toBe('same');
        expect(yield* native.scan({ _tag: 'Pids', pids: [] })).toEqual([]);
      }),
    );

    it.effect('excludes a replaced pid from execution relations when its owner changes during the listing', () =>
      Effect.gen(function* () {
        const native = yield* Processes;
        const { witness } = yield* ListeningProcess;
        let read = 0;
        const changed: ProcessReader = {
          ...native,
          scan: (request) =>
            Effect.map(native.scan(request), (rows) => {
              const replaced = ++read > 1;
              return rows.map((row) => (row.pid === witness.pid && replaced ? { ...row, birth: 'replacement-birth' } : row));
            }),
        };
        const probe = yield* evidenceProbe(LIMITS).pipe(Effect.provideService(Processes, changed));
        const scans = yield* makeEvidenceScans({ limits: SCANS }).pipe(Effect.provideService(EvidenceReader, probe));
        const observed: ObservedExecution = { ref, scope: probe.scope, leader: witness };
        const topology: ExecutionTopology = { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) };
        const report = yield* (yield* makeProcessEvidence({ topology, scans })).processes(execution);
        expect(report?.processes.filter((row) => row.association !== undefined)).toEqual([]);
        expect(report?.completeness).not.toBe('complete');
        expect(report?.unmeasured.some((region) => region.region === `the identity and facts of pid ${witness.pid}`)).toBe(true);
      }),
    );

    it.effect('does not give an execution a socket whose holder changed between ps and lsof', () =>
      Effect.gen(function* () {
        const native = yield* Processes;
        const { witness } = yield* ListeningProcess;
        let read = 0;
        const changed: ProcessReader = {
          ...native,
          scan: (request) =>
            Effect.map(native.scan(request), (rows) => {
              const replaced = ++read > 2;
              return rows.map((row) => (row.pid === witness.pid && replaced ? { ...row, birth: 'replacement-birth' } : row));
            }),
        };
        const probe = yield* evidenceProbe(LIMITS).pipe(Effect.provideService(Processes, changed));
        const scans = yield* makeEvidenceScans({ limits: SCANS }).pipe(Effect.provideService(EvidenceReader, probe));
        const observed: ObservedExecution = { ref, scope: probe.scope, leader: witness };
        const topology: ExecutionTopology = { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) };
        const report = yield* (yield* makeProcessEvidence({ topology, scans })).listeners(execution);
        expect(report?.listeners).toEqual([]);
        expect(report?.completeness).toBe('partial');
        expect(report?.unmeasured.map((region) => region.reason)).toContain('unknown');
      }),
    );

    it.effect('measures when a process it is given began, and refuses a number this kernel cannot hold instead of losing the listing', () =>
      Effect.gen(function* () {
        const reader = yield* EvidenceReader;
        const { witness } = yield* ListeningProcess;
        const measured = yield* reader.processes({ _tag: 'Pids', pids: [witness.pid, 999_999] });
        const found = measured.found.find((row) => row.identity.pid === witness.pid);
        expect(identityMatch(witness, found?.identity)).toBe('same');
        expect(found?.command).toContain('Bun.listen');
        expect(measured.completeness).toBe('partial');
        expect(measured.unmeasured.map((region) => region.reason)).toContain('unsupported');
      }),
    );

    it.effect('finds the listening socket a process actually holds, and names that process as its holder', () =>
      Effect.gen(function* () {
        const reader = yield* EvidenceReader;
        const { witness, port } = yield* ListeningProcess;
        const measured = yield* reader.listeners({ _tag: 'Held', pids: [witness.pid] });
        const socket = measured.found.find((held) => held.port === port);
        expect(socket).toBeDefined();
        expect(socket?.holder.pid).toBe(witness.pid);
        expect(socket?.protocol).toBe('tcp');
        expect(socket?.address).toBe('127.0.0.1');
        expect(measured.completeness).toBe('partial');
        expect(measured.unmeasured.map((region) => region.region)).toEqual(['udp sockets']);
      }),
    );

    it.effect('answers the whole namespace as an inventory, and says which parts of it were not measured', () =>
      Effect.gen(function* () {
        const reader = yield* EvidenceReader;
        const { port } = yield* ListeningProcess;
        const measured = yield* reader.listeners({ _tag: 'Inventory' });
        expect(measured.found.some((held) => held.port === port)).toBe(true);
        expect(measured.completeness).toBe('partial');
        expect(measured.unmeasured.some((region) => region.region === 'udp sockets')).toBe(true);
        const refused = measured.unmeasured.filter((region) => region.reason === 'refused');
        expect(refused.every((region) => region.port !== undefined && region.port !== port)).toBe(true);
      }),
    );

    it.effect('reports a listing the operating system refused as unavailable with what it said, never as an empty machine', () =>
      Effect.gen(function* () {
        const reader = yield* EvidenceReader;
        const measured = yield* reader.processes({ _tag: 'Terminal', terminal: 'ttys999' });
        expect(measured.completeness).toBe('unavailable');
        expect(measured.found).toEqual([]);
        expect(measured.unmeasured.find((region) => region.reason === 'failed')?.detail).toContain('ttys999');
      }),
    );

    it.effect('answers a reading cut at its byte bound with the rows it read whole, and says it was cut', () =>
      Effect.gen(function* () {
        const bounded = yield* evidenceProbe({ ...LIMITS, outputBytes: 32 });
        const whole = yield* EvidenceReader;
        const [cut, full] = yield* Effect.all([bounded.listeners({ _tag: 'Inventory' }), whole.listeners({ _tag: 'Inventory' })]);
        expect(cut.completeness).toBe('partial');
        expect(cut.unmeasured.some((region) => region.reason === 'truncated')).toBe(true);
        const measured = new Set(full.found.map((held) => `${held.address}:${held.port}/${held.holder.pid}`));
        for (const held of cut.found) expect(measured.has(`${held.address}:${held.port}/${held.holder.pid}`)).toBe(true);
      }),
    );

    it.effect('does not publish an unfinished process row when the stderr cap stops the probe', () =>
      Effect.gen(function* () {
        const { witness } = yield* ListeningProcess;
        const real = yield* ChildProcessSpawner.ChildProcessSpawner;
        const interrupted = ChildProcessSpawner.make((command) =>
          Effect.gen(function* () {
            if (command._tag !== 'StandardCommand' || command.command !== PS) return yield* real.spawn(command);
            const listed = yield* Deferred.make<void>();
            const child = yield* real.spawn(
              ChildProcess.make(
                '/bin/sh',
                ['-c', `printf '${witness.pid} 1 1 ?? S unfinished'; exec 1>&-; while :; do printf diagnostic >&2; done`],
                command.options,
              ),
            );
            return {
              ...child,
              stdout: child.stdout.pipe(Stream.ensuring(Deferred.succeed(listed, undefined))),
              stderr: Stream.unwrap(Effect.as(Deferred.await(listed), child.stderr)),
            };
          }),
        );
        const probe = yield* evidenceProbe({ ...LIMITS, errorBytes: 32 }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, interrupted),
        );
        const measured = yield* probe.processes({ _tag: 'Pids', pids: [witness.pid] });
        expect(measured.found).toEqual([]);
        expect(measured.completeness).toBe('unavailable');
        expect(measured.unmeasured.some((region) => region.reason === 'refused')).toBe(true);
      }),
    );

    it.effect('answers an unfinished evidence probe as unmeasured instead of an empty measurement', () =>
      Effect.gen(function* () {
        const { witness } = yield* ListeningProcess;
        const probe = yield* evidenceProbe({ ...LIMITS, probeMs: 1 }).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make(() => Effect.never),
          ),
        );
        const measured = yield* probe.processes({ _tag: 'Pids', pids: [witness.pid] });
        expect(measured.completeness).toBe('unavailable');
        expect(measured.unmeasured.map((region) => region.reason)).toEqual(['timeout']);
      }),
    );

    it.effect('asks nobody when the question names no process it can address, and says so', () =>
      Effect.gen(function* () {
        const reader = yield* EvidenceReader;
        const measured = yield* reader.listeners({ _tag: 'Held', pids: [] });
        expect(measured.completeness).toBe('unavailable');
        expect(measured.found).toEqual([]);
        expect(measured.unmeasured.some((region) => region.reason === 'unknown')).toBe(true);
      }),
    );

    it.effect('carries a real socket up to the execution that holds it, with the identity that was proved', () =>
      Effect.gen(function* () {
        const reader = yield* EvidenceReader;
        const { witness, port } = yield* ListeningProcess;
        const scans = yield* makeEvidenceScans({ limits: SCANS });
        const observed = { ref, scope: reader.scope, leader: witness };
        const topology: ExecutionTopology = { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) };
        const report = yield* (yield* makeProcessEvidence({ topology, scans })).listeners(execution);
        const socket = report?.listeners.find((held) => held.port === port);
        expect(socket?.association).toEqual({ execution: ref, relation: 'leader', identity: 'same' });
        expect(identityMatch(witness, socket?.holder)).toBe('same');
        expect(report?.subject).toEqual({ _tag: 'Execution', execution: ref });
      }),
    );
  });

  describe('what already stands on this machine', () => {
    it.effect('falls back to allocated terminals when a live masters probe exceeds the stderr cap', () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const devices = FileSystem.FileSystem.of({
          ...files,
          readDirectory: (path) =>
            path === '/dev' ? Effect.succeed(['ttys000', 'ttys001', 'tty', 'ptmx', 'ttys-not-a-terminal']) : files.readDirectory(path),
        });
        const real = yield* ChildProcessSpawner.ChildProcessSpawner;
        const refused = ChildProcessSpawner.make((command) =>
          real.spawn(
            command._tag === 'StandardCommand' && command.args.includes('/dev/ptmx')
              ? ChildProcess.make('/bin/sh', ['-c', 'while :; do printf "the terminal table is unavailable\\n" >&2; done'], command.options)
              : command,
          ),
        );
        const bounded = yield* readStanding(LIMITS, process.pid, yield* loadLibrary(HOLDER_LIBRARY)).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, refused),
          Effect.provideService(FileSystem.FileSystem, devices),
        );
        expect(bounded.terminals).toBe(2);
        expect(bounded.descriptors).toBeGreaterThan(0);
      }),
    );

    it.effect('the native descriptor count follows the files this process opens and closes', () =>
      Effect.gen(function* () {
        const library = yield* loadLibrary(HOLDER_LIBRARY);
        const before = library.abi.descriptors(process.pid);
        if ('refusal' in before) return yield* Effect.die(new Error(before.detail));
        const during = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() => openSync('/dev/null', 'r')),
              (fd) => Effect.sync(() => closeSync(fd)),
            );
            return library.abi.descriptors(process.pid);
          }),
        );
        expect(during).toEqual({ count: before.count + 1 });
        expect(library.abi.descriptors(process.pid)).toEqual(before);
      }),
    );

    it.effect('counts the terminals standing now, and gives them back when they are released', () =>
      Effect.gen(function* () {
        const real = yield* ChildProcessSpawner.ChildProcessSpawner;
        let terminal = process.pid;
        const probe = ChildProcessSpawner.make((command) =>
          real.spawn(
            command._tag === 'StandardCommand' && command.args.includes('/dev/ptmx')
              ? ChildProcess.make(command.command, ['-a', '-p', String(terminal), ...command.args], command.options)
              : command,
          ),
        );
        const standing = readStanding(LIMITS, process.pid, yield* loadLibrary(HOLDER_LIBRARY)).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, probe),
        );
        const before = yield* standing;
        const during = yield* Effect.scoped(
          Effect.gen(function* () {
            let command: number | undefined;
            const child = yield* Effect.acquireRelease(
              Effect.sync(() =>
                Bun.spawn(['/usr/bin/script', '-q', '/dev/null', '/bin/sh', '-c', 'printf "\\n%s\\n" "$$"; exec tail -f /dev/null'], {
                  stdin: 'ignore',
                  stdout: 'pipe',
                  stderr: 'ignore',
                }),
              ),
              (child) =>
                Effect.andThen(
                  Effect.sync(() => {
                    if (child.exitCode === null) process.kill(command ?? child.pid, 'SIGTERM');
                  }),
                  Effect.promise(() => child.exited),
                ),
            );
            terminal = child.pid;
            command = yield* Effect.promise(async () => {
              const reader = child.stdout.getReader();
              const decoder = new TextDecoder();
              let printed = '';
              let pid: RegExpMatchArray | null = null;
              try {
                while (pid === null) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  printed += decoder.decode(chunk.value, { stream: true });
                  pid = printed.match(/(?:^|\r?\n)([0-9]+)\r?\n/);
                }
              } finally {
                reader.releaseLock();
              }
              return pid === null ? undefined : Number(pid[1]);
            });
            expect(command).toBeGreaterThan(0);
            return yield* standing;
          }),
        );
        const after = yield* standing;
        expect(before.terminals).toBe(0);
        expect(during.terminals - before.terminals).toBe(1);
        expect(after.terminals).toBe(before.terminals);
      }),
    );
  });
});
