import type { LimitProvenance } from '@runlith/executions/protocol/command';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import type { NativeExit } from '@runlith/executions/protocol/execution';
import type { ExecutionAddress } from '../Repo.js';
import { commandWord } from '../commandWord.js';

export type ProcessKind = 'command' | 'terminal';

export type ProcessPhase = 'reserved' | 'queued' | 'starting' | 'running' | 'stopping' | 'ended';

export type WaitMode = 'foreground' | 'background';

export type ProcessLive = 'held' | 'unheld' | 'unavailable';

export type ProcessLimit = {
  readonly executionMs: number | null;
  readonly ceilingMs: number | null;
  readonly revision: number;
  readonly expiresAt: number | null;
  readonly origin: LimitProvenance;
};

export type ProcessOwner = {
  readonly thread: string | null;
  readonly label: string;
  readonly internal: boolean;
  readonly archived: boolean;
};

export type ProcessPort = {
  readonly port: number;
  readonly address: string;
  readonly url: string | null;
};

export type ProcessLine = {
  readonly key: string;
  readonly address: ExecutionAddress;
  readonly kind: ProcessKind;
  readonly transport: 'pipes' | 'pty';
  readonly opens: boolean;
  readonly printed: boolean | null;
  readonly owner: ProcessOwner;
  readonly wait: WaitMode | null;
  readonly phase: ProcessPhase | null;
  readonly live: ProcessLive;
  readonly label: string | null;
  readonly command: string | null;
  readonly cwd: string | null;
  readonly note: string | null;
  readonly ports: readonly ProcessPort[];
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly ranMs: number | null;
  readonly exit: NativeExit | null;
  readonly limit: ProcessLimit | null;
  readonly waitMs: number | null;
  readonly stoppedByLimit: boolean;
  readonly outer: boolean;
  readonly unstarted: string | null;
  readonly place: string | null;
  readonly current: string | null;
};

export const UNSTARTED_WORDS = {
  'not-started': 'not started',
  timeout: 'timed out before it started',
  'run-abort': 'abandoned before it started',
  'scope-closed': 'its scope closed before it started',
  'caller-lost': 'its caller left before it started',
  'explicit-stop': 'stopped before it started',
  shutdown: 'the host shut down before it started',
} as const satisfies Record<CancellationCause, string>;

export function unstartedNote(unstarted: string): string {
  const cut = unstarted.indexOf(': ');
  const named = cut === -1 ? '' : unstarted.slice(0, cut);
  const worded = named in UNSTARTED_WORDS ? UNSTARTED_WORDS[named as CancellationCause] : null;
  return worded === null ? `${UNSTARTED_WORDS['not-started']} · ${unstarted}` : `${worded} · ${unstarted.slice(cut + 2)}`;
}

export function exitWords(exit: NativeExit): string {
  return exit._tag === 'Code' ? `exit ${exit.code}` : exit.signal;
}

const NEAR_LIMIT_MS = 60_000;

export const isUnheld = (line: ProcessLine): boolean => line.kind === 'command' && line.live === 'unheld';

export const isLive = (line: ProcessLine): boolean => line.phase !== 'ended' && !isUnheld(line);

export const isQueued = (line: ProcessLine): boolean => line.phase === 'queued' || line.phase === 'reserved';

export function elapsedMs(line: ProcessLine, now: number): number | null {
  if (!isLive(line) && line.ranMs !== null) return line.ranMs;
  if (line.startedAt === null) return null;
  if (!isLive(line) && line.endedAt === null) return null;
  return Math.max(0, (line.endedAt ?? now) - line.startedAt);
}

function remainingMs(line: ProcessLine, now: number): number | null {
  if (line.limit === null || line.limit.expiresAt === null || !isLive(line)) return null;
  return line.limit.expiresAt - now;
}

export function isNearLimit(line: ProcessLine, now: number): boolean {
  if (line.stoppedByLimit && isLive(line)) return true;
  const remaining = remainingMs(line, now);
  return remaining !== null && remaining < NEAR_LIMIT_MS;
}

export function badgeWord(line: ProcessLine): string {
  const first = line.label?.trim().split(/\s+/)[0];
  if (first !== undefined && first !== '') return first.toLowerCase();
  return line.command === null ? 'command' : commandWord(line.command);
}

const LOCAL_BINDS = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::', '*']);

export function portUrl(address: string, port: number): string | null {
  return LOCAL_BINDS.has(address) ? `http://localhost:${port}/` : null;
}

const ownerKey = (owner: ProcessOwner): string =>
  owner.internal ? 'internal' : owner.thread === null ? 'operator' : `thread:${owner.thread}`;

export const isOperator = (owner: ProcessOwner): boolean => ownerKey(owner) === 'operator';
