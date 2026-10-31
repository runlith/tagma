import { expect, test } from 'bun:test';
import { performanceAnswerText, performanceText } from './voice.js';
import type { PerformanceValue } from './contract/wire/performance.js';

test('the ledger text retains both acknowledged statement elapsed measures', () => {
  const counts = {
    statements: 2,
    units: 0,
    programs: 1,
    programStatements: 3,
    statementMs: 17.5,
    statementExecMs: 3.25,
    writerHoldMs: 4,
    writerWaitMs: 5,
    requestBytes: 6,
    responseBytes: 7,
    spans: 8,
  };
  const performance = {
    type: 'ledger',
    ledgerId: 'ledger',
    reset: false,
    rows: [{ id: 'root', sequence: 1, name: 'read', startedAt: 1, endedAt: 2, total: counts, own: counts, producers: [] }],
    total: 1,
    next: null,
    evicted: 0,
    unattributedStatements: 0,
  } satisfies PerformanceValue;
  const lines = performanceAnswerText({ performance })!.split('\n');
  const header = lines.find((line) => line.startsWith('bucket\t'))!.split('\t');
  const values = lines.find((line) => line.startsWith('own\t'))!.split('\t');
  expect(Object.fromEntries(header.map((key, index) => [key, values[index]]))).toMatchObject({
    statementMs: '17.5',
    statementExecMs: '3.25',
  });
});

const memory = {
  rssBytes: 1_213_923_328,
  heapTotalBytes: 410_027_008,
  heapUsedBytes: 436_123_099,
  externalBytes: 103_728_818,
  arrayBufferBytes: 2_838_802,
};

const blocked = {
  id: 'db182fdd-aa9f-47e3-8174-6e363011cfa4',
  kind: 'stall',
  instanceId: '36b5cb34',
  wallTime: 1_788_351_757_363,
  monotonicStart: 1_000,
  monotonicEnd: 5_801.85,
  payload: {
    delayMs: 4_801.849167,
    cpu: { userMicros: 14_855, systemMicros: 14_715 },
    cpuWindowMs: 4_826.8,
    memory,
    profileId: '63d32bc8-0a4e-4a3e-9c46-7a1a2c0ff2b1',
  },
} as const;

const frame = {
  functionName: 'spawnSync',
  url: 'file:///opt/workspaces/runlith/apps/tagma/server/src/files/submitWork.ts',
  lineNumber: 365,
  selfMs: 4_780.2,
  samples: 478,
};

const caller = {
  name: 'agent.tool-call',
  runId: '01a061fe-a5c4-76c7-b9d7-d697f4261dee',
  threadId: '01a061cb-2f1a-7d90-9f1e-4a3c8b2d5e60',
  toolName: 'submit_work',
  toolCallId: 'call-1',
  coveredMs: 4_801.8,
  durationMs: 4_930.4,
};

test('the stalls list answers cause, frame and caller on each row', () => {
  const value = {
    type: 'stalls',
    inheritedDrops: 0,
    sessionDrops: 0,
    retainedRange: { from: 1, to: 2 },
    stalls: [
      { stall: blocked, cause: 'blocked', sampling: { samples: 478, sampledMs: 4_780.2, frame }, caller },
      {
        stall: {
          ...blocked,
          id: 'busy',
          payload: { ...blocked.payload, delayMs: 100.1, cpu: { userMicros: 114_200, systemMicros: 3_500 } },
        },
        cause: 'cpu',
        sampling: null,
        caller: null,
      },
    ],
    next: null,
  } as unknown as PerformanceValue;

  const text = performanceText(value);
  expect(text).toContain(
    '4802 ms\tblocked\t478 samples, 4780.2 of 4802 ms\tspawnSync at file:///opt/workspaces/runlith/apps/tagma/server/src/files/submitWork.ts:365 (478 samples, 4780.2 ms)\tsubmit_work of thread 01a061cb-2f1a-7d90-9f1e-4a3c8b2d5e60',
  );
  expect(text).toContain('100 ms\tcpu\tno profile\t—\t—\tbusy');
});

test('a stall the sampler barely saw names no frame, and its loop CPU stands apart from the process CPU', () => {
  const value = {
    type: 'stall',
    inheritedDrops: 0,
    sessionDrops: 0,
    retainedRange: { from: 1, to: 2 },
    stall: {
      ...blocked,
      payload: {
        ...blocked.payload,
        delayMs: 509.3,
        cpu: { userMicros: 400_000, systemMicros: 54_900 },
        cpuWindowMs: 509.3,
        loopCpu: { userMicros: 30_000, systemMicros: 1_000 },
      },
    },
    cause: 'blocked',
    sampling: { samples: 1, sampledMs: 1, frame: null },
    callers: [],
    overlap: [],
    spans: [],
    vitals: [],
    next: null,
  } as unknown as PerformanceValue;

  const text = performanceText(value);
  expect(text).toContain('over 509.3 ms: loop thread cpu 31.0 ms; process cpu, every thread, 454.9 ms');
  expect(text).toContain('frame — the sampler saw the loop busy for under half the stall (1 sample, 1.0 of 509 ms)');
});

test('one stall prints the CPU it burned over the window that CPU covers', () => {
  const value = {
    type: 'stall',
    inheritedDrops: 0,
    sessionDrops: 0,
    retainedRange: { from: 1, to: 2 },
    stall: blocked,
    cause: 'blocked',
    sampling: { samples: 478, sampledMs: 4_780.2, frame },
    callers: [
      caller,
      { ...caller, name: 'agent.run', durationMs: 10_800_000, toolName: undefined, toolCallId: undefined },
      { ...caller, name: 'agent.model-step', threadId: undefined, toolName: undefined, coveredMs: 12, durationMs: 40 },
    ],
    overlap: [{ name: 'sql.execute', count: 3, totalMs: 12, maxMs: 8 }],
    spans: [],
    vitals: [],
    next: null,
  } as unknown as PerformanceValue;

  const text = performanceText(value);
  expect(text).toContain(blocked.payload.profileId);
  expect(text).toContain(String(blocked.wallTime));
  expect(text).toContain('4801.849167 ms, blocked');
  expect(text).toContain('over 4826.8 ms: loop thread cpu unmeasured; process cpu, every thread, 29.6 ms');
  expect(text).toContain('frame spawnSync at');
  expect(text.indexOf('agent.tool-call')).toBeLessThan(text.indexOf('agent.run'));
  expect(text).toContain('sql.execute');
  expect(text).toContain('coveredMs\tdurationMs\trun\tthread\ttool\tname');
  expect(text).toContain('12.0\t40.0\t01a061fe-a5c4-76c7-b9d7-d697f4261dee\t—\tcall-1\tagent.model-step');
});

test('a capture answers its receipt and the profiles a stall kept out of its window, never the artifact it kept', () => {
  const nodes = Array.from({ length: 5_000 }, (_, id) => ({ id, callFrame: { functionName: `frame${id}`, url: '', lineNumber: 0 } }));
  const value = {
    type: 'captured',
    profile: {
      id: 'capture-1',
      kind: 'profile',
      instanceId: '36b5cb34',
      wallTime: 1_788_351_757_363,
      monotonicStart: 4_000,
      monotonicEnd: 30_000,
      payload: {
        requestedBy: 'audit',
        requestedDurationMs: 30_000,
        profile: { nodes, startTime: 0, endTime: 1, samples: [], timeDeltas: [] },
      },
    },
    cuts: [{ id: 'stall-profile-1', requestedBy: 'stall' }],
  } as unknown as PerformanceValue;

  const text = performanceText(value);
  expect(text).toContain('capture-1');
  expect(text).toContain('stall-profile-1');
  expect(text.length).toBeLessThan(1_000);
});

test('a kept memory reading answers the totals and the head of each table', () => {
  const types = (top: number) => [
    { name: 'Array', count: top },
    ...Array.from({ length: 150 }, (_, at) => ({ name: `Rare${at}`, count: 1 })),
  ];
  const thread = (name: string, objects: number, top: number) => ({
    thread: name,
    censusMs: 36.4,
    process: { ...memory, rssBytes: 1_070_000_000, heapUsedBytes: 285_000_000 },
    heap: { sizeBytes: 1, capacityBytes: 2, extraMemoryBytes: 3, objectCount: objects, protectedObjectCount: 4 },
    largestTypes: types(top),
  });
  const value = {
    type: 'reading-kept',
    reading: {
      id: 'f0c1e2d3-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
      kind: 'memory',
      instanceId: '36b5cb34',
      wallTime: 1_788_351_757_363,
      monotonicStart: 1_000,
      monotonicEnd: 1_100,
      payload: {
        requestedBy: 'perf-audit baseline',
        threads: [thread('main', 1_700_000, 412_000), thread('store-worker', 240_000, 90_000)],
        collected: { pauseMs: 36.2, threads: [thread('main', 1_600_000, 400_000), thread('store-worker', 230_000, 88_000)] },
      },
    },
  } as unknown as PerformanceValue;

  const text = performanceText(value);
  expect(text).toContain('reading f0c1e2d3-4a5b-6c7d-8e9f-0a1b2c3d4e5f');
  expect(text).toContain('perf-audit baseline');
  expect(text).toContain('main\t1.07 GB\t285.0 MB');
  expect(text).toContain('pause 36 ms');
  expect(text).toContain('read_performance type: growth');
  expect(text).toContain('+143 more types');
  expect(text).not.toContain('Rare9');
  expect(text.split('\n').length).toBeLessThan(15);
});
