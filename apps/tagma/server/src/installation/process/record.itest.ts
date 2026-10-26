import { expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Result, Schema } from 'effect';
import { restartStateSchema } from '../contract/wire/restart.js';
import { makeProcessRestart, type ProcessRestart } from './record.js';

const rooted = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'restart-record-'))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

const latest = (record: ProcessRestart) => Effect.map(record.state, (state) => state.record);

const observed = { id: 'opening', name: 'stores opening', pid: 102, startedAt: 10, endedAt: null, durationMs: null, outcome: null };

it.live('a heavy plan is readable before handover and survives successor startup', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'heavy.json');
    const heavy = {
      migrations: [{ name: 'indexed', reason: 'Build a history index' }],
      tables: [{ name: 'history', maxRowid: 1000, snapshot: false }],
      files: [],
    };
    const predecessor = yield* makeProcessRestart({ path, pid: 101 });
    const id = yield* predecessor.begin(heavy);
    const waiting = yield* makeProcessRestart({ path, pid: 103 });
    waiting.load();
    expect(yield* waiting.state).toMatchObject({ startup: { pid: 101, status: 'starting', heavy } });
    const successor = yield* makeProcessRestart({ path, pid: 102, incoming: id });
    successor.load();
    successor.start(1);
    expect(yield* successor.state).toMatchObject({ record: { heavy }, startup: { pid: 102, heavy } });
  }),
);

it.live('a cold startup leaves its last phase, declared step and caught failure readable after the process leaves', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'startup.json');
    const process = yield* makeProcessRestart({ path, pid: 102 });
    process.load();
    process.start(1, 5000);
    yield* process.phase(observed);
    process.opening({ phase: 'migration', path: 'machine.sqlite', at: 10, name: 'declared', index: 1, total: 2 });
    const interrupted = yield* makeProcessRestart({ path, pid: 103 });
    interrupted.load();
    expect(yield* interrupted.state).toMatchObject({
      stage: null,
      startup: { status: 'starting', phase: 'stores opening', expectedMs: 5000, step: { index: 1, total: 2 }, failure: null },
    });
    yield* process.phase({ ...observed, endedAt: 20, durationMs: 10, outcome: 'failed' });
    process.fail('the migration refused');
    const failed = yield* makeProcessRestart({ path, pid: 103 });
    failed.load();
    expect(yield* failed.state).toMatchObject({
      startup: { status: 'failed', failure: { phase: 'stores opening', detail: 'the migration refused' } },
    });
    const retry = yield* makeProcessRestart({ path, pid: 104 });
    retry.load();
    retry.start(30);
    expect(yield* retry.state).toMatchObject({
      record: { predecessor: null, successor: { pid: 104 }, phases: [], failure: null },
      startup: { pid: 104, status: 'starting', failure: null, step: null },
    });
  }),
);

it.live('restart stages come from the recorded transfer, full door and both restoration facts', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'stages.json');
    const predecessor = yield* makeProcessRestart({ path, pid: 101 });
    const id = yield* predecessor.begin();
    const stage = (process: ProcessRestart) => Effect.map(process.state, (state) => state.stage);
    expect(yield* stage(predecessor)).toBe('accepted');
    predecessor.point('standing-by');
    expect(yield* stage(predecessor)).toBe('prepared');
    const successor = yield* makeProcessRestart({ path, pid: 102, incoming: id });
    successor.load();
    successor.start(1);
    successor.point('data-taken');
    expect(yield* stage(successor)).toBe('transferred');
    successor.point('door-ready', { door: 'local', at: 20 });
    expect(yield* stage(successor)).toBe('serving');
    expect(yield* Schema.encodeUnknownEffect(restartStateSchema)(yield* predecessor.state)).toMatchObject({ stage: 'prepared' });
    expect(yield* Schema.encodeUnknownEffect(restartStateSchema)(yield* successor.state)).toMatchObject({
      startup: { status: 'ready' },
    });
    successor.frame('local', 1, 'place', 25);
    expect(yield* stage(successor)).toBe('serving');
    successor.point('runs-restored');
    expect(yield* stage(successor)).toBe('restored');
    yield* successor.phase({ ...observed, id: 'artifact', name: 'artifact door opened', endedAt: 30, durationMs: 5, outcome: 'failed' });
    successor.fail('the artifact port is occupied');
    expect(yield* successor.state).toMatchObject({
      stage: 'failed',
      startup: { status: 'failed', readyAt: 20, failure: { phase: 'artifact door opened', detail: 'the artifact port is occupied' } },
    });
  }),
);

it.live('the successor receives predecessor phases and client windows survive a cold read', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'transfer.json');
    const predecessor = yield* makeProcessRestart({ path, pid: 101 });
    predecessor.identify({ cut: null, installation: { build: 'earlier', digest: 'earlier-digest' } });
    predecessor.point('door-ready', { door: 'local' });
    const id = yield* predecessor.begin();
    const stamp = {
      id: 'owners',
      name: 'owners closed',
      pid: 101,
      startedAt: 100,
      endedAt: 150,
      durationMs: 50,
      outcome: 'completed' as const,
    };
    yield* predecessor.phase(stamp);
    predecessor.point('door-closed', { door: 'local' });
    predecessor.point('owners-closed');

    const successor = yield* makeProcessRestart({ path, pid: 102, incoming: id });
    yield* successor.phase({ ...stamp, id: 'take', pid: 102, name: 'catalogue taken' });
    successor.load();
    successor.identify({ cut: null, installation: { build: 'later', digest: 'later-digest' } });
    successor.point('data-taken');
    successor.frame('local', 1, 'place', yield* Clock.currentTimeMillis);
    const window = { restartId: id, clientId: 'surface', door: 'local' as const, projectId: 1, threadId: 'place', durationMs: 12_345 };
    const reported = yield* successor.report(window);
    expect(reported.predecessor?.source.installation?.build).toBe('earlier');
    expect(reported.successor).toMatchObject({ pid: 102, source: { installation: { build: 'later' } } });
    expect(reported.phases).toEqual([stamp, { ...stamp, id: 'take', pid: 102, name: 'catalogue taken' }]);
    expect(reported.frames[0]?.intervalMs).toBeGreaterThanOrEqual(0);
    expect(reported.windows).toEqual([expect.objectContaining({ ...window, exceeded: true })]);
    expect(yield* successor.report(window)).toEqual(reported);

    const cold = yield* makeProcessRestart({ path, pid: 103 });
    cold.load();
    expect(yield* latest(cold)).toEqual(reported);
    yield* cold.phase(stamp);
    expect(yield* latest(cold)).toEqual(reported);
  }),
);

it.live('an incoming process without a predecessor record keeps its observed phases and accepts its client window', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'first.json');
    const successor = yield* makeProcessRestart({ path, pid: 102 });
    successor.receive(101);
    const stamp = {
      id: 'prepared',
      name: 'installation read',
      pid: 102,
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
      outcome: 'completed' as const,
    };
    yield* successor.phase(stamp);
    successor.identify({ cut: null, installation: { build: 'arrived', digest: 'arrived-digest' } });
    expect(Result.isSuccess(successor.load())).toBe(true);
    const record = yield* latest(successor);
    expect(record).toMatchObject({ predecessor: { pid: 101, source: { cut: null, installation: null } }, successor: { pid: 102 } });
    expect(record?.phases).toEqual([stamp]);
    expect(record?.points).toEqual([]);
    if (record === null) return yield* Effect.die('the incoming process did not record its arrival');
    const reported = yield* successor.report({
      restartId: record.id,
      clientId: 'client',
      door: 'local',
      projectId: 1,
      threadId: 'place',
      durationMs: 123,
    });
    const cold = yield* makeProcessRestart({ path, pid: 103 });
    cold.load();
    expect(yield* latest(cold)).toEqual(reported);
  }),
);

it.live('a stale or conflicting window is refused without changing the accepted report', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'refusals.json');
    const predecessor = yield* makeProcessRestart({ path, pid: 101 });
    const id = yield* predecessor.begin();
    const successor = yield* makeProcessRestart({ path, pid: 102, incoming: id });
    successor.load();
    const window = { restartId: id, clientId: 'surface', door: 'local' as const, projectId: 1, threadId: 'place', durationMs: 123 };
    expect(yield* Effect.flip(successor.report({ ...window, restartId: 'another' }))).toMatchObject({ _tag: 'RestartWindowRefused' });
    successor.frame('local', 1, 'place', yield* Clock.currentTimeMillis);
    const accepted = yield* successor.report(window);
    for (const refused of [
      { ...window, restartId: 'another' },
      { ...window, durationMs: 124 },
    ]) {
      expect(yield* Effect.flip(successor.report(refused))).toMatchObject({ _tag: 'RestartWindowRefused' });
      expect(yield* latest(successor)).toEqual(accepted);
    }
  }),
);

it.live('another restart replaces the preceding record instead of adding to its phases', () =>
  Effect.gen(function* () {
    const predecessor = yield* makeProcessRestart({ path: join(yield* rooted, 'next.json'), pid: 101 });
    const first = yield* predecessor.begin();
    predecessor.point('standing-by');
    predecessor.fail('candidate left');
    const second = yield* predecessor.begin();
    const record = yield* latest(predecessor);
    expect(second).not.toBe(first);
    expect(record).toMatchObject({ id: second, phases: [], frames: [], windows: [], failure: null });
    expect(record?.points.map((point) => point.name)).toEqual(['accepted']);
  }),
);

it.live('an unreadable diagnostic is answered with its reason without a startup defect', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'broken.json');
    writeFileSync(path, '{');
    for (const incoming of [undefined, 'asked']) {
      const process = yield* makeProcessRestart({ path, pid: 102, incoming });
      expect(Result.isFailure(process.load())).toBe(true);
      expect(yield* process.state).toMatchObject({ record: null, issue: { kind: 'unreadable', path } });
    }
  }),
);

it.live('a diagnostic missing a required field reports an issue while a fresh startup records its current form', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'incomplete.json');
    const previous = yield* makeProcessRestart({ path, pid: 101 });
    const id = yield* previous.begin();
    const saved = yield* latest(previous);
    writeFileSync(path, JSON.stringify({ ...saved, startup: undefined }));
    const process = yield* makeProcessRestart({ path, pid: 102, incoming: id });
    expect(Result.isFailure(process.load())).toBe(true);
    expect(yield* process.state).toMatchObject({ record: null, issue: { kind: 'unreadable', path } });
    process.start(1);
    const reader = yield* makeProcessRestart({ path, pid: 103 });
    expect(Result.isSuccess(reader.load())).toBe(true);
    expect(yield* reader.state).toMatchObject({ startup: { status: 'starting', pid: 102, failure: null }, issue: null });
  }),
);

it.live('an unwritable diagnostic keeps observing while explicit publication refuses', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'blocked.json');
    const predecessor = yield* makeProcessRestart({ path, pid: 101 });
    const id = yield* predecessor.begin();
    const successor = yield* makeProcessRestart({ path, pid: 102, incoming: id });
    successor.load();
    rmSync(path);
    mkdirSync(path);
    const published = yield* successor.phase({
      id: 'close',
      name: 'owners closed',
      pid: 102,
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
      outcome: 'completed',
    });
    successor.point('owners-closed');
    expect(published.status).toBe('unavailable');
    expect(yield* successor.state).toMatchObject({
      issue: { kind: 'unwritable', path },
      record: { phases: [{ id: 'close' }] },
    });
    const refused = yield* Effect.flip(
      successor.report({ restartId: id, clientId: 'surface', door: 'local', projectId: 1, threadId: 'place', durationMs: 123 }),
    );
    expect(refused._tag).toBe('RestartRecordUnwritable');
  }),
);

it.live('a confirmed client window ends first-frame capture without losing later recovery phases', () =>
  Effect.gen(function* () {
    const path = join(yield* rooted, 'bounded.json');
    const predecessor = yield* makeProcessRestart({ path, pid: 101 });
    const id = yield* predecessor.begin();
    const successor = yield* makeProcessRestart({ path, pid: 102, incoming: id });
    successor.load();
    successor.frame('local', 1, 'place', 10);
    yield* successor.report({ restartId: id, clientId: 'surface', door: 'local', projectId: 1, threadId: 'place', durationMs: 123 });
    successor.frame('remote', 2, 'later', 1000);
    successor.point('door-ready', { door: 'remote' });
    yield* successor.phase({
      id: 'recovery',
      name: 'recovery triggered',
      pid: 102,
      startedAt: 20,
      endedAt: 21,
      durationMs: 1,
      outcome: 'completed',
    });
    const record = yield* latest(successor);
    expect(record?.frames).toEqual([expect.objectContaining({ door: 'local', threadId: 'place' })]);
    expect(record?.points.map((point) => point.name)).toEqual(['accepted']);
    expect(record?.phases).toEqual([expect.objectContaining({ id: 'recovery', outcome: 'completed' })]);
  }),
);
