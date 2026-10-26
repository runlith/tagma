import { afterAll, expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Clock, Console, Effect, Schema } from 'effect';
import { Console as NodeConsole } from 'node:console';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { CHANGE_WRITES } from '../../change-record/contract/wire/writes.js';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE } from '../../platform/contract/service/credentials.js';
import { HOOK_OPERATIONS } from '../contract/wire/hooks.js';
import { hookReports } from './hookReports.js';
import { toolEntryId } from '@runlith/agent/transcript/entryNames';
import { CurrentInvocation, Invocation } from '../../platform/cli/verb.js';
import { hookEventOf } from '../hooks/dispatch.js';
import { hookConnectOver } from '../hooks/door.js';
import { hookPendingDir, keepPendingOp, listPendingOps } from '../hooks/pendingWrites.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';

const root = mkdtempSync(join(tmpdir(), 'hook-writes-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const writeSchema = CHANGE_WRITES.record_write.input;
type Write = typeof writeSchema.Type;
type Reports = Effect.Success<ReturnType<typeof hookReports>>;

const scenario = (name: string, named: HarnessName | null = null, reports?: Reports) => {
  const path = join(root, `${name}.ts`);
  const pending = hookPendingDir(root, name);
  const recorded: Write[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let condition: 'record-unread' | 'unreachable' | 'outside' | 'recorded' = 'record-unread';
  const connect = hookConnectOver(() =>
    Effect.succeed({
      operations: {
        perform: (request) => {
          if (request.params.id === 'record_write') {
            return Effect.flatMap(Schema.decodeUnknownEffect(writeSchema)(request.payload), (write): Effect.Effect<unknown, unknown> => {
              if (condition === 'record-unread') return Effect.fail({ code: condition, reason: 'the checkout record is unreadable' });
              if (condition === 'unreachable') return Effect.fail(new Error('connection reset'));
              if (condition === 'outside') return Effect.succeed({ status: 'outside', path: write.path });
              recorded.push(write);
              return Effect.succeed({ status: 'recorded', path: write.path });
            });
          }
          if (request.params.id === 'touch_path') return Effect.succeed({ status: 'ok', briefs: [], places: [] });
          if (request.params.id === 'report_harness_event' && reports !== undefined) {
            return Schema.decodeUnknownEffect(HOOK_OPERATIONS.report_harness_event.input)(request.payload).pipe(
              Effect.flatMap((input) => reports.reports.reported(reports.id, input)),
              Effect.map((receipt) => ({ status: 'reported', ...receipt })),
            );
          }
          return Effect.fail({ code: 'not-a-harness-thread', reason: 'the fixture only records writes' });
        },
      },
    }),
  );
  const collecting = (chunks: string[]) =>
    new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk));
        done();
      },
    });
  const console = new NodeConsole({ stdout: collecting(out), stderr: collecting(err), colorMode: false });
  const hook = (event: 'pre-tool-use' | 'post-tool-use') => {
    const payload = {
      session_id: name,
      hook_event_name: reports === undefined ? undefined : event === 'pre-tool-use' ? 'PreToolUse' : 'PostToolUse',
      prompt_id: reports === undefined ? undefined : 'turn',
      tool_name: 'Write',
      tool_use_id: reports === undefined ? undefined : `call-${name}`,
      tool_input: { file_path: path },
    };
    const at = new Invocation(
      { [GRANT_VARIABLE]: 'fixture-grant', [SESSION_TOKEN_VARIABLE]: reports?.session, TMPDIR: root },
      root,
      () => new Blob([JSON.stringify(payload)]).stream(),
      'hook',
    );
    return hookEventOf(event, at, connect, named).pipe(
      Effect.provideService(CurrentInvocation, at),
      Effect.provideService(Console.Console, console),
    );
  };
  return { path, pending, recorded, out, err, hook, set: (next: typeof condition) => (condition = next) };
};

const capturedWrite = Effect.fnUntraced(function* (path: string, key: string) {
  return {
    kind: 'hook-write' as const,
    key,
    path,
    base: path,
    before: 'before\n',
    after: 'after\n',
    capturedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  };
});

const denyRead = (path: string, mode: number) => {
  if (process.getuid?.() === 0) {
    const held = `${path}.held`;
    renameSync(path, held);
    symlinkSync(path, path);
    return {
      code: 'ELOOP',
      restore: () => {
        rmSync(path);
        renameSync(held, path);
      },
    };
  }
  chmodSync(path, 0);
  return { code: 'EACCES', restore: () => chmodSync(path, mode) };
};

const unreadEvidence = (dir: string) => {
  const at = join(dir, 'unread');
  return readdirSync(at).map((name) => JSON.parse(readFileSync(join(at, name), 'utf8')));
};

layer(BunFileSystem.layer, { excludeTestServices: true })('hook writes', (it) => {
  it.effect('a refused write keeps its witness across the next edit without being replayed as recorded', () =>
    Effect.gen(function* () {
      const run = scenario('refused');
      writeFileSync(run.path, 'before\n');
      yield* run.hook('pre-tool-use');
      writeFileSync(run.path, 'first\n');
      yield* run.hook('post-tool-use');

      const refused = join(run.pending, 'refused');
      const evidence = () => readdirSync(refused).map((name) => JSON.parse(readFileSync(join(refused, name), 'utf8')));
      expect(evidence()).toEqual([
        expect.objectContaining({
          before: 'before\n',
          after: 'first\n',
          path: run.path,
          refusal: { code: 'record-unread', reason: 'the checkout record is unreadable' },
        }),
      ]);
      expect(run.recorded).toEqual([]);
      expect(run.err.join('')).toContain('record-unread');
      const answer = JSON.parse(run.out.join(''));
      expect(answer.hookSpecificOutput.hookEventName).toBe('PostToolUse');
      expect(answer.hookSpecificOutput.additionalContext).toContain('record-unread');
      expect(answer.hookSpecificOutput.additionalContext).toContain('the checkout record is unreadable');
      expect(answer.hookSpecificOutput.additionalContext).toContain(refused);

      run.set('recorded');
      yield* run.hook('pre-tool-use');
      writeFileSync(run.path, 'second\n');
      yield* run.hook('post-tool-use');
      expect(run.recorded.map(({ before, after }) => [before, after])).toEqual([['first\n', 'second\n']]);
      expect(evidence()).toEqual([
        expect.objectContaining({
          before: 'before\n',
          after: 'first\n',
          refusal: { code: 'record-unread', reason: 'the checkout record is unreadable' },
        }),
      ]);
      expect(listPendingOps(run.pending).ops).toEqual([]);
    }),
  );

  it.effect('a pending write that receives a refusal is retained as evidence rather than replayed on later hooks', () =>
    Effect.gen(function* () {
      const run = scenario('pending-refused');
      writeFileSync(run.path, 'before\n');
      yield* run.hook('pre-tool-use');
      writeFileSync(run.path, 'first\n');
      run.set('unreachable');
      yield* run.hook('post-tool-use');
      expect(listPendingOps(run.pending).ops).toEqual([expect.objectContaining({ before: 'before\n', after: 'first\n' })]);

      run.set('record-unread');
      yield* run.hook('pre-tool-use');
      expect(listPendingOps(run.pending).ops).toEqual([]);
      expect(run.err.join('')).toContain('record-unread');
      const answer = JSON.parse(run.out.join(''));
      expect(answer.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(answer.hookSpecificOutput.additionalContext).toContain('record-unread');
      expect(answer.hookSpecificOutput.additionalContext).toContain('the checkout record is unreadable');
      run.set('recorded');
      yield* run.hook('pre-tool-use');
      expect(run.recorded).toEqual([]);
      const refused = join(run.pending, 'refused');
      const stored = readdirSync(refused).map((name) => JSON.parse(readFileSync(join(refused, name), 'utf8')));
      expect(stored).toEqual([
        expect.objectContaining({
          before: 'before\n',
          after: 'first\n',
          refusal: { code: 'record-unread', reason: 'the checkout record is unreadable' },
        }),
      ]);
    }),
  );

  it.effect('outside settles a captured write without keeping a refused or retryable record', () =>
    Effect.gen(function* () {
      const run = scenario('outside');
      run.set('outside');
      writeFileSync(run.path, 'before\n');
      yield* run.hook('pre-tool-use');
      writeFileSync(run.path, 'after\n');
      yield* run.hook('post-tool-use');
      run.set('recorded');
      yield* run.hook('post-tool-use');
      expect(run.recorded).toEqual([]);
      expect(listPendingOps(run.pending).ops).toEqual([]);
      expect(run.out).toEqual([]);
      expect(run.err).toEqual([]);
    }),
  );

  it.effect('a refused archive supersedes a pending copy left behind by interrupted cleanup', () =>
    Effect.gen(function* () {
      const run = scenario('refused-remainder');
      writeFileSync(run.path, 'before\n');
      yield* run.hook('pre-tool-use');
      writeFileSync(run.path, 'after\n');
      yield* run.hook('post-tool-use');
      const archive = join(run.pending, 'refused');
      const stored = JSON.parse(readFileSync(join(archive, readdirSync(archive)[0]!), 'utf8'));
      expect(keepPendingOp(run.pending, { ...stored, refusal: undefined })).toBe(true);
      run.set('recorded');
      yield* run.hook('pre-tool-use');
      expect(run.recorded).toEqual([]);
      expect(listPendingOps(run.pending).ops).toEqual([]);
    }),
  );

  it.effect('an unavailable archive keeps a terminal refusal in the captured write itself', () =>
    Effect.gen(function* () {
      const run = scenario('archive-unavailable');
      mkdirSync(run.pending);
      writeFileSync(join(run.pending, 'refused'), 'occupied');
      writeFileSync(run.path, 'before\n');
      yield* run.hook('pre-tool-use');
      writeFileSync(run.path, 'after\n');
      yield* run.hook('post-tool-use');
      const stored = readdirSync(run.pending)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(join(run.pending, name), 'utf8')));
      expect(stored).toEqual([
        expect.objectContaining({
          before: 'before\n',
          after: 'after\n',
          refusal: { code: 'record-unread', reason: 'the checkout record is unreadable' },
        }),
      ]);
      run.set('recorded');
      yield* run.hook('pre-tool-use');
      expect(run.recorded).toEqual([]);
      expect(listPendingOps(run.pending).ops).toEqual([]);
    }),
  );

  it.effect('a mixed queue records sound writes and preserves typed evidence of malformed records', () =>
    Effect.gen(function* () {
      const reports = yield* hookReports({ name: 'claude-code', key: 'mixed-unread' });
      yield* reports.reports.reported(reports.id, {
        session: reports.session,
        event: { hook_event_name: 'UserPromptSubmit', session_id: 'mixed-unread', prompt_id: 'turn' },
        receipt: 'open',
      });
      const opened = (yield* reports.world.ledger.activeRun(reports.id))?.id;
      expect(opened).toBeDefined();
      const run = scenario('mixed-unread', 'claude-code', reports);
      run.set('recorded');
      writeFileSync(run.path, 'current\n');
      expect(keepPendingOp(run.pending, yield* capturedWrite(run.path, 'sound'))).toBe(true);
      const broken = join(run.pending, 'broken.json');
      const wrong = join(run.pending, 'wrong.json');
      writeFileSync(broken, '{');
      writeFileSync(wrong, JSON.stringify({ kind: 'hook-write' }));
      yield* run.hook('pre-tool-use');

      expect(run.recorded.map(({ before, after }) => [before, after])).toEqual([['before\n', 'after\n']]);
      expect(readFileSync(broken, 'utf8')).toBe('{');
      expect(readFileSync(wrong, 'utf8')).toBe(JSON.stringify({ kind: 'hook-write' }));
      expect(unreadEvidence(run.pending)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'hook-write-unread', path: broken, operation: 'parse', code: 'invalid-json' }),
          expect.objectContaining({ kind: 'hook-write-unread', path: wrong, operation: 'shape', code: 'invalid-shape' }),
        ]),
      );
      const answer = JSON.parse(run.out[0]!);
      expect(answer.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(answer.hookSpecificOutput.additionalContext).toContain('invalid-json');
      expect(answer.hookSpecificOutput.additionalContext).toContain('invalid-shape');
      expect(run.err.join('')).toContain(broken);
      expect(yield* reports.storage.aggregate.entryById(reports.id, toolEntryId('call-mixed-unread'))).toMatchObject({
        toolState: 'input-available',
        runId: opened,
      });
      const unread = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ key: Schema.String })))(unreadEvidence(run.pending));
      for (const failure of unread)
        expect(yield* reports.storage.aggregate.entryById(reports.id, toolEntryId(failure.key))).toMatchObject({
          toolState: 'output-error',
          runId: opened,
        });

      yield* run.hook('pre-tool-use');
      expect(unreadEvidence(run.pending)).toHaveLength(2);
      writeFileSync(run.path, 'next\n');
      yield* run.hook('post-tool-use');
      expect(run.recorded.map(({ before, after }) => [before, after])).toEqual([
        ['before\n', 'after\n'],
        ['current\n', 'next\n'],
      ]);
    }),
  );

  it.effect('an unreadable record leaves its peers deliverable and recovers after access is restored', () =>
    Effect.gen(function* () {
      const run = scenario('access-unread');
      run.set('recorded');
      writeFileSync(run.path, 'current\n');
      expect(keepPendingOp(run.pending, yield* capturedWrite(run.path, 'sound'))).toBe(true);
      expect(keepPendingOp(run.pending, yield* capturedWrite(run.path, 'blocked'))).toBe(true);
      const blocked = join(run.pending, 'blocked.json');
      const denied = denyRead(blocked, 0o600);
      try {
        yield* run.hook('pre-tool-use');
        expect(run.recorded.map(({ key }) => key)).toEqual(['sound']);
        expect(unreadEvidence(run.pending)).toEqual([expect.objectContaining({ path: blocked, operation: 'read', code: denied.code })]);
        const answer = JSON.parse(run.out[0]!);
        expect(answer.hookSpecificOutput.additionalContext).toContain(denied.code);
        expect(answer.hookSpecificOutput.additionalContext).toContain(blocked);
        expect(listPendingOps(run.pending).unread).toEqual([
          expect.objectContaining({ path: blocked, operation: 'read', code: denied.code }),
        ]);
      } finally {
        denied.restore();
      }
      yield* run.hook('pre-tool-use');
      expect(run.recorded.map(({ key }) => key)).toEqual(['sound', 'blocked']);
      expect(listPendingOps(run.pending)).toEqual({ ops: [], unread: [] });
    }),
  );

  it.effect('an unreadable queue returns a typed directory failure without preventing the hook from finishing', () =>
    Effect.gen(function* () {
      const run = scenario('directory-unread');
      run.set('recorded');
      writeFileSync(run.path, 'current\n');
      expect(keepPendingOp(run.pending, yield* capturedWrite(run.path, 'captured'))).toBe(true);
      const denied = denyRead(run.pending, 0o700);
      try {
        yield* run.hook('pre-tool-use');
        expect(run.recorded).toEqual([]);
        expect(listPendingOps(run.pending)).toEqual({
          ops: [],
          unread: [expect.objectContaining({ path: run.pending, operation: 'list', code: denied.code })],
        });
        const answer = JSON.parse(run.out[0]!);
        expect(answer.hookSpecificOutput.additionalContext).toContain(denied.code);
        expect(run.err.join('')).toContain(run.pending);
      } finally {
        denied.restore();
      }
      yield* run.hook('pre-tool-use');
      expect(run.recorded.map(({ key }) => key)).toEqual(['captured']);
    }),
  );

  it.effect('a Cursor refusal keeps the declared output protocol when reporting yields no receipt', () =>
    Effect.gen(function* () {
      const run = scenario('cursor-refused', 'cursor');
      writeFileSync(run.path, 'before\n');
      yield* run.hook('pre-tool-use');
      writeFileSync(run.path, 'after\n');
      yield* run.hook('post-tool-use');
      const answer = JSON.parse(run.out.join(''));
      expect(answer.additional_context).toContain('record-unread');
      expect(answer.additional_context).toContain('the checkout record is unreadable');
      expect(run.err.join('')).toContain('record-unread');
    }),
  );
});
