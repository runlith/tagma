import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import type { ActorRef } from '../../platform/contract/wire/actor.js';
import type { QueuedCommit } from './queue.js';

const Caller = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('operator') }),
  Schema.Struct({ kind: Schema.Literal('thread'), threadId: Schema.NonEmptyString, projectId: Schema.Int }),
  Schema.Struct({
    kind: Schema.Literal('session'),
    session: Schema.Struct({ harness: Schema.NonEmptyString, key: Schema.NonEmptyString }),
    projectId: Schema.Int,
  }),
]);

const TerminalCaller = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Thread'), threadId: Schema.NonEmptyString, projectId: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal('Foreign'), harness: Schema.NonEmptyString, key: Schema.NonEmptyString, projectId: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal('Operator') }),
]);

const commitFields = {
  op: Schema.NonEmptyString,
  projectId: Schema.Int,
  root: Schema.NonEmptyString,
  commit: Schema.NonEmptyString,
  holder: Schema.NonEmptyString,
};

export const Queued = Schema.Struct({ ...commitFields, caller: Schema.optional(Caller) });
const TerminalQueued = Schema.Struct({ ...commitFields, caller: TerminalCaller });
const Line = Schema.Union([
  Schema.Struct({ seq: Schema.Int, queued: Schema.Union([Queued, TerminalQueued]) }),
  Schema.Struct({ done: Schema.Int }),
]);
const readLine = Schema.decodeUnknownResult(Line);

const callerOf = (caller: typeof TerminalCaller.Type): ActorRef =>
  caller._tag === 'Operator'
    ? { kind: 'operator' }
    : caller._tag === 'Thread'
      ? { kind: 'thread', threadId: caller.threadId, projectId: caller.projectId }
      : { kind: 'session', session: { harness: caller.harness, key: caller.key }, projectId: caller.projectId };

const queuedOf = ({ caller, ...commit }: typeof Queued.Type | typeof TerminalQueued.Type): QueuedCommit =>
  caller === undefined ? commit : { ...commit, caller: 'kind' in caller ? caller : callerOf(caller) };

export type Waiting = { readonly seq: number; readonly queued: QueuedCommit; failures: number };
export type JournalMemory = { readonly next: number; readonly unstruck: ReadonlySet<number> };
export type Restored = {
  readonly waiting: Map<number, Waiting>;
  readonly held: Map<number, number>;
  readonly unread: number;
  readonly next: number;
  readonly unstruck: Set<number>;
};

export type JournalAsk =
  | { readonly kind: 'open'; readonly path: string; readonly memory: JournalMemory }
  | { readonly kind: 'admit'; readonly seq: number; readonly queued: QueuedCommit }
  | { readonly kind: 'settle'; readonly seq: number };

export const JournalFailure = Schema.Struct({ kind: Schema.Literal('failed'), reason: Schema.String });
export type JournalReply =
  | { readonly kind: 'opened'; readonly restored: Restored }
  | { readonly kind: 'stored'; readonly warning: string | null }
  | typeof JournalFailure.Type;
export type JournalReady = { readonly kind: 'ready' };

export type Journal = {
  readonly admit: (seq: number, queued: QueuedCommit) => void;
  readonly settle: (seq: number) => string | null;
};

type Active = { readonly row: string; readonly queued: QueuedCommit };

export const journalAt = (path: string, memory: JournalMemory) => {
  const active = new Map<number, Active>();
  const unread: string[] = [];
  let whole = true;
  let certain = true;
  let done = 0;
  let next = memory.next;
  if (existsSync(path)) {
    const text = readFileSync(path, 'utf8');
    whole = text === '' || text.endsWith('\n');
    for (const row of text.split('\n')) {
      if (row.trim() === '') continue;
      const parsed = Result.flatMap(
        Result.try(() => JSON.parse(row)),
        readLine,
      );
      if (Result.isFailure(parsed)) unread.push(row);
      else if ('done' in parsed.success) {
        active.delete(parsed.success.done);
        next = Math.max(next, parsed.success.done + 1);
        done += 1;
      } else {
        active.set(parsed.success.seq, { row, queued: queuedOf(parsed.success.queued) });
        next = Math.max(next, parsed.success.seq + 1);
      }
    }
  }
  const waiting = new Map<number, Waiting>();
  const held = new Map<number, number>();
  const unstruck = new Set<number>();
  for (const [seq, record] of [...active].sort(([left], [right]) => left - right)) {
    if (memory.unstruck.has(seq)) unstruck.add(seq);
    else {
      waiting.set(seq, { seq, queued: record.queued, failures: 0 });
      held.set(record.queued.projectId, (held.get(record.queued.projectId) ?? 0) + 1);
    }
  }

  const append = (row: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    const text = `${whole ? '' : '\n'}${row}\n`;
    whole = false;
    let fd: number | undefined;
    try {
      fd = openSync(path, 'a');
      writeFileSync(fd, text);
      fsyncSync(fd);
      whole = true;
    } catch (failure) {
      certain = false;
      throw failure;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };

  const compact = (): void => {
    const temporary = `${path}.${randomUUID()}.next`;
    let fd: number | undefined;
    try {
      const target = openSync(temporary, 'wx');
      fd = target;
      let rows: string[] = [];
      let size = 0;
      const retain = (row: string): void => {
        rows.push(`${row}\n`);
        size += row.length + 1;
        if (size < 64 * 1024) return;
        writeFileSync(target, rows.join(''));
        rows = [];
        size = 0;
      };
      for (const row of unread) retain(row);
      for (const record of active.values()) retain(record.row);
      if (rows.length > 0) writeFileSync(fd, rows.join(''));
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, path);
      whole = true;
      if (process.platform !== 'win32') {
        const parent = openSync(dirname(path), 'r');
        try {
          fsyncSync(parent);
        } finally {
          closeSync(parent);
        }
      }
      done = 0;
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  };

  const journal: Journal = {
    admit: (seq, queued) => {
      const row = JSON.stringify({ seq, queued });
      append(row);
      active.set(seq, { row, queued });
    },
    settle: (seq) => {
      if (active.size === 1 && active.has(seq) && unread.length === 0 && certain) {
        certain = false;
        const fd = openSync(path, 'w');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        active.delete(seq);
        whole = true;
        certain = true;
        done = 0;
        return null;
      }
      append(JSON.stringify({ done: seq }));
      active.delete(seq);
      done += 1;
      if (certain && done >= 64 && done >= active.size) {
        try {
          compact();
        } catch (failure) {
          return String(failure);
        }
      }
      return null;
    },
  };
  return { restored: { waiting, held, unread: unread.length, next, unstruck } satisfies Restored, journal };
};
