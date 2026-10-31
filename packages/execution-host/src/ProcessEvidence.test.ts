import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import type { EvidenceNamespace, ListenerSnapshot, ProcessSnapshot } from '@runlith/executions/protocol/evidence';
import { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import { EvidenceReader, type EvidenceProbe, type Measured, type ScanLimits, makeEvidenceScans } from './EvidenceScans';
import { makeProcessEvidence, type ExecutionTopology, type ObservedExecution } from './ProcessEvidence';

const machine: EvidenceNamespace = { _tag: 'Local', machine: 'evidence-test' };
const guest: EvidenceNamespace = { _tag: 'Foreign', kind: 'guest', id: 'sandbox-1' };
const scope = { host: machine, network: machine };
const elsewhere = { host: guest, network: guest };
const source = { adapter: 'test', probe: 'rows' };

const readRef = Schema.decodeUnknownSync(ExecutionRef);
const readId = Schema.decodeUnknownSync(ExecutionId);

const ref = readRef({ installation: 'installation-1', execution: 'execution-1', incarnation: 1 });
const execution = readId('execution-1');

const AT = 1_757_000_000_000;
const BIRTH = 'birth-1';
const STARTED = BIRTH;

const process = (
  pid: number,
  fields: {
    readonly parent?: number;
    readonly work?: number;
    readonly terminal?: string;
    readonly witness?: string;
  } = {},
): ProcessSnapshot => ({
  scope,
  source,
  observedAt: AT,
  completeness: 'complete',
  unmeasured: [],
  identity: fields.witness === undefined ? { pid } : { pid, birth: fields.witness },
  parent: fields.parent,
  work: fields.work,
  terminal: fields.terminal,
});

const listener = (port: number, pid: number): ListenerSnapshot => ({
  scope,
  source,
  observedAt: AT,
  completeness: 'complete',
  unmeasured: [],
  protocol: 'tcp',
  address: '127.0.0.1',
  port,
  holder: { pid, birth: BIRTH },
});

const LEADER = process(100, { work: 100, terminal: 'ttys7', witness: STARTED });
const FAMILY = [
  LEADER,
  process(101, { parent: 100, work: 100, terminal: 'ttys7', witness: STARTED }),
  process(104, { parent: 1, work: 100, terminal: 'ttys7', witness: STARTED }),
  process(102, { parent: 1, work: 102, terminal: 'ttys7', witness: STARTED }),
  process(103, { parent: 1, work: 103, terminal: 'ttys8', witness: STARTED }),
];

const answering = (processes: Measured<ProcessSnapshot>, listeners: Measured<ListenerSnapshot>): EvidenceProbe => ({
  scope,
  processes: () => Effect.succeed(processes),
  listeners: () => Effect.succeed(listeners),
});

const measured = <A>(found: ReadonlyArray<A>): Measured<A> => ({
  observedAt: AT,
  completeness: 'complete',
  unmeasured: [],
  found,
});

const holding = (observed: ObservedExecution | undefined): ExecutionTopology => ({
  of: () => Effect.succeed(observed),
  watching: Effect.succeed(observed === undefined ? [] : [observed]),
});

const LIMITS: ScanLimits = { concurrency: 2, flight: 4, freshMs: 0, retained: 4, results: 16 };

const evidence = (topology: ExecutionTopology, probe: EvidenceProbe) =>
  Effect.flatMap(makeEvidenceScans({ limits: LIMITS }).pipe(Effect.provideService(EvidenceReader, probe)), (scans) =>
    makeProcessEvidence({ topology, scans }),
  );

const local = (leader = { pid: 100, birth: BIRTH, terminal: 'ttys7' }): ObservedExecution => ({ ref, scope, leader });

describe('ProcessEvidence', () => {
  it.effect('claims a process only through a relation it measured, and claims nothing of a row it merely saw', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(holding(local()), answering(measured(FAMILY), measured([])));
          return yield* owner.processes(execution);
        }),
      );
      const relations = new Map(report?.processes.map((row) => [row.identity.pid, row.association?.relation]));
      expect(relations.get(100)).toBe('leader');
      expect(relations.get(101)).toBe('ancestry');
      expect(relations.get(104)).toBe('work');
      expect(relations.get(102)).toBe('terminal');
      expect(relations.get(103)).toBeUndefined();
      expect(report?.completeness).toBe('complete');
      expect(report?.subject).toEqual({ _tag: 'Execution', execution: ref });
      const identities = new Map(report?.processes.map((row) => [row.identity.pid, row.association?.identity]));
      expect(identities.get(100)).toBe('same');
      expect([identities.get(101), identities.get(104), identities.get(102)]).toEqual(['unknown', 'unknown', 'unknown']);
    }),
  );

  it.effect('answers nothing at all once the pid it started is held by a process born outside its own start', () =>
    Effect.gen(function* () {
      const [processes, listeners] = yield* Effect.scoped(
        Effect.gen(function* () {
          const reused = FAMILY.map((row) =>
            row.identity.pid === 100 ? process(100, { work: 100, terminal: 'ttys7', witness: 'birth-2' }) : row,
          );
          const owner = yield* evidence(holding(local()), answering(measured(reused), measured([listener(5173, 101)])));
          return yield* Effect.all([owner.processes(execution), owner.listeners(execution)]);
        }),
      );
      expect(processes?.completeness).toBe('unavailable');
      expect(processes?.processes).toEqual([]);
      expect(processes?.unmeasured.map((region) => region.reason)).toContain('unknown');
      expect(listeners?.completeness).toBe('unavailable');
      expect(listeners?.listeners).toEqual([]);
    }),
  );

  it.effect('ties a listening socket to an execution through the process holding it', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(holding(local()), answering(measured(FAMILY), measured([listener(5173, 101)])));
          return yield* owner.listeners(execution);
        }),
      );
      const socket = report?.listeners.find((held) => held.port === 5173);
      expect(socket?.association).toEqual({ execution: ref, relation: 'ancestry', identity: 'unknown' });
      expect(socket?.holder).toEqual({ pid: 101, birth: STARTED });
      expect(report?.subject).toEqual({ _tag: 'Execution', execution: ref });
    }),
  );

  it.effect('does not claim sockets of an unproven or replaced holder', () =>
    Effect.gen(function* () {
      for (const birth of [undefined, 'birth-2']) {
        const socket = { ...listener(5173, 101), holder: { pid: 101, birth } };
        const report = yield* Effect.scoped(
          Effect.gen(function* () {
            const owner = yield* evidence(holding(local()), answering(measured(FAMILY), measured([socket])));
            return yield* owner.listeners(execution);
          }),
        );
        expect(report?.listeners).toEqual([]);
        expect(report?.completeness).toBe('partial');
        expect(report?.unmeasured.map((region) => region.reason)).toContain('unknown');
      }
    }),
  );

  it.effect('answers with the sockets of the processes it related, and with nobody else\u2019s', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(
            holding(local()),
            answering(measured(FAMILY), measured([listener(5173, 101), listener(9999, 103)])),
          );
          return yield* owner.listeners(execution);
        }),
      );
      expect(report?.listeners.map((socket) => socket.port)).toEqual([5173]);
    }),
  );

  it.effect('keeps a failed measurement as unavailable with the region nobody measured, never as an empty world', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(
            holding(local()),
            answering(
              {
                observedAt: AT,
                completeness: 'unavailable',
                unmeasured: [
                  { region: 'the processes attached to ttys7', reason: 'refused', detail: 'ps: /dev/ttys7: No such file or directory' },
                ],
                found: [],
              },
              measured([]),
            ),
          );
          return yield* owner.processes(execution);
        }),
      );
      expect(report?.completeness).toBe('unavailable');
      expect(report?.processes).toEqual([]);
      expect(report?.unmeasured[0]?.reason).toBe('refused');
    }),
  );

  it.effect('measures nothing in a namespace it cannot reach, and names that namespace instead of answering with this machine', () =>
    Effect.gen(function* () {
      const [ofExecution, ofNamespace] = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(
            holding({ ref, scope: elsewhere, leader: { pid: 100 } }),
            answering(measured(FAMILY), measured([listener(3000, 100)])),
          );
          return yield* Effect.all([owner.listeners(execution), owner.inventory(elsewhere)]);
        }),
      );
      for (const report of [ofExecution, ofNamespace]) {
        expect(report?.completeness).toBe('unavailable');
        expect(report?.listeners).toEqual([]);
        expect(report?.revision).toBe(0);
        expect(report?.unmeasured[0]?.reason).toBe('unsupported');
      }
      expect(ofNamespace.unmeasured[0]?.region).toContain('sandbox-1');
    }),
  );

  it.effect('answers a namespace inventory with every listening socket, naming an execution only for sockets its processes hold', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(
            holding(local()),
            answering(measured(FAMILY), measured([listener(3000, 100), listener(5173, 101), listener(9999, 103)])),
          );
          return yield* owner.inventory(scope);
        }),
      );
      expect(report.subject).toEqual({ _tag: 'Namespace' });
      expect(report.listeners.map((socket) => [socket.port, socket.association])).toEqual([
        [3000, { execution: ref, relation: 'leader', identity: 'same' }],
        [5173, { execution: ref, relation: 'ancestry', identity: 'unknown' }],
        [9999, undefined],
      ]);
      expect(report.completeness).toBe('complete');
    }),
  );

  it.effect('leaves the namespace sockets unassociated and says so when the pid an execution started is held by another process', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const reused = FAMILY.map((row) =>
            row.identity.pid === 100 ? process(100, { work: 100, terminal: 'ttys7', witness: 'birth-2' }) : row,
          );
          const owner = yield* evidence(holding(local()), answering(measured(reused), measured([listener(5173, 101)])));
          return yield* owner.inventory(scope);
        }),
      );
      expect(report.listeners.map((socket) => socket.association)).toEqual([undefined]);
      expect(report.completeness).toBe('partial');
      expect(report.unmeasured.map((region) => region.reason)).toContain('unknown');
    }),
  );

  it.effect('claims relations under a pid nothing proved, and says the identity was never measured', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(
            holding({ ref, scope, leader: { pid: 100, terminal: 'ttys7' } }),
            answering(measured(FAMILY), measured([])),
          );
          return yield* owner.processes(execution);
        }),
      );
      expect(report?.processes.find((row) => row.identity.pid === 100)?.association).toEqual({
        execution: ref,
        relation: 'leader',
        identity: 'unknown',
      });
      expect(report?.completeness).toBe('partial');
      expect(report?.unmeasured.some((region) => region.region.includes('identity'))).toBe(true);
    }),
  );

  it.effect('refuses a scope that shares one namespace with this host and not the other', () =>
    Effect.gen(function* () {
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* evidence(holding(local()), answering(measured(FAMILY), measured([listener(3000, 100)])));
          return yield* owner.inventory({ host: machine, network: guest });
        }),
      );
      expect(report.completeness).toBe('unavailable');
      expect(report.listeners).toEqual([]);
      expect(report.revision).toBe(0);
    }),
  );

  it.effect(
    'says an execution with no native process has nothing to measure from, and answers nothing at all for one it does not hold',
    () =>
      Effect.gen(function* () {
        const [pending, unknown] = yield* Effect.scoped(
          Effect.gen(function* () {
            const waiting = yield* evidence(holding({ ref, scope }), answering(measured(FAMILY), measured([])));
            const absent = yield* evidence(holding(undefined), answering(measured(FAMILY), measured([])));
            return yield* Effect.all([waiting.processes(execution), absent.processes(execution)]);
          }),
        );
        expect(pending?.completeness).toBe('unavailable');
        expect(pending?.processes).toEqual([]);
        expect(pending?.unmeasured[0]?.reason).toBe('unknown');
        expect(unknown).toBeUndefined();
      }),
  );
});
