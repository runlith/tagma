import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';

const child = spawn(process.execPath, [join(import.meta.dir, 'agentLoad.bench.ts'), ...process.argv.slice(2)], {
  env: { ...process.env, BUN_JSC_logGC: '1', AGENT_LOAD_CHILD: '1' },
  stdio: ['inherit', 'pipe', 'pipe'],
});

const interrupt = (): void => {
  child.kill('SIGINT');
};
const terminate = (): void => {
  child.kill('SIGTERM');
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

const identifyBegin = 'AGENT_LOAD_GC_IDENTIFY_BEGIN';
const identifyEnd = 'AGENT_LOAD_GC_IDENTIFY_END';
const windowBegin = 'AGENT_LOAD_WINDOW_BEGIN';
const windowEnd = 'AGENT_LOAD_WINDOW_END';
const heaps = new Set<string>();
const samples: number[] = [];
let identifying = false;
let identified = false;
let heap: string | undefined;
let window: 'before' | 'open' | 'closed' = 'before';
let beganAt: string | undefined;
let endedAt: string | undefined;
let ambiguousFragments = 0;
let markerAmbiguousSegments = 0;
let unparseablePauses = 0;
let suppressedFragments = 0;
let windowSuppressedFragments = 0;
let tail = '';
let problem: string | undefined;

const retain = (line: string): void => {
  suppressedFragments += 1;
  if (window === 'open') windowSuppressedFragments += 1;
  tail = `${tail}${line}\n`.slice(-65536);
};

const printTail = (): void => {
  if (tail !== '') process.stderr.write(`agent-load-gc: retained unclassified stderr tail (up to 65536 characters):\n${tail}`);
};

const refuse = (reason: string): void => {
  problem ??= reason;
};

const marker = (value: string): void => {
  if (value === identifyBegin) {
    if (identifying || identified || window !== 'before') refuse('invalid GC identification begin marker');
    identifying = true;
  } else if (value === identifyEnd) {
    if (!identifying || identified) refuse('invalid GC identification end marker');
    identifying = false;
    identified = true;
    if (heaps.size === 1) heap = heaps.values().next().value;
  } else if (value === windowBegin) {
    if (!identified || window !== 'before') refuse('invalid GC observation window begin marker');
    window = 'open';
    beganAt = new Date().toISOString();
  } else if (value === windowEnd) {
    if (window !== 'open') refuse('invalid GC observation window end marker');
    window = 'closed';
    endedAt = new Date().toISOString();
  }
  process.stderr.write(`${value}\n`);
};

const segment = (line: string, affected: boolean): void => {
  if (line === '') return;
  const ids = [...line.matchAll(/GC<([^>]+)>:/g)];
  const pauses = [...line.matchAll(/\bp\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)ms\b/g)];
  const pauseFields = [...line.matchAll(/\bp\s*=/g)];
  if (identifying && /Full sweep:/.test(line)) {
    for (const id of ids) heaps.add(id[1]!);
  }
  if (affected) {
    markerAmbiguousSegments += 1;
    if (window === 'open') ambiguousFragments += pauseFields.length;
    if (/\b(?:error|warning|warn|fatal|exception|failed)\b|^\s*at\s/i.test(line)) process.stderr.write(`${line}\n`);
    else retain(line);
    return;
  }
  if (ids.length === 0) {
    if (window === 'open') ambiguousFragments += pauseFields.length;
    if (/\b(?:error|warning|warn|fatal|exception|failed)\b|^\s*at\s/i.test(line)) process.stderr.write(`${line}\n`);
    else if (!/^\s*(?:GC END!|Requesting GC\b)/.test(line)) retain(line);
    return;
  }
  if (ids.length !== 1 || pauses.length > 1 || (pauses[0]?.index ?? Infinity) < ids[0]!.index!) {
    if (window === 'open') ambiguousFragments += pauseFields.length;
    retain(line);
    return;
  }
  const id = ids[0]![1]!;
  if (heap !== undefined && id === heap) {
    if (pauseFields.length !== pauses.length) {
      unparseablePauses += 1;
      retain(line);
      return;
    }
    const pause = pauses[0];
    if (pause !== undefined) {
      const value = Number(pause[1]);
      if (!Number.isFinite(value) || value < 0) {
        unparseablePauses += 1;
        retain(line);
      } else if (window === 'open') samples.push(value);
    }
  }
};

const stderr = async (): Promise<void> => {
  const lines = createInterface({ input: child.stderr, crlfDelay: Infinity });
  const markers = /AGENT_LOAD_GC_IDENTIFY_BEGIN|AGENT_LOAD_GC_IDENTIFY_END|AGENT_LOAD_WINDOW_BEGIN|AGENT_LOAD_WINDOW_END/g;
  for await (const line of lines) {
    const found = [...line.matchAll(markers)];
    if (found.length === 0) {
      segment(line, false);
      continue;
    }
    const affected = found.length !== 1 || line !== found[0]![0];
    let position = 0;
    for (const hit of found) {
      segment(line.slice(position, hit.index), affected);
      marker(hit[0]);
      position = hit.index! + hit[0].length;
    }
    segment(line.slice(position), affected);
  }
};

const windowClosed = (): boolean => window === 'closed';
const stdout = pipeline(child.stdout, process.stdout, { end: false });
const reading = stderr();
const [code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
await Promise.all([stdout, reading]);
process.off('SIGINT', interrupt);
process.off('SIGTERM', terminate);
if (code !== 0 || signal !== null) {
  printTail();
  process.stderr.write(`agent-load-gc: child failed (exit ${String(code)}, signal ${String(signal)})\n`);
  if (signal !== null) {
    process.exitCode = 1;
    process.kill(process.pid, signal);
  } else process.exitCode = code ?? 1;
} else {
  if (!identified || identifying) refuse('main heap identification did not complete');
  if (!windowClosed() || beganAt === undefined || endedAt === undefined) refuse('GC observation window did not complete');
  if (problem !== undefined) printTail();
  const usable = problem === undefined && heap !== undefined;
  samples.sort((a, b) => a - b);
  const percentile = (share: number): number | null =>
    !usable || samples.length === 0 ? null : samples[Math.ceil(samples.length * share) - 1]!;
  process.stdout.write(
    `${JSON.stringify({
      benchmark: 'agent-load-gc',
      heap: usable ? heap : null,
      heapCandidates: [...heaps],
      window: { beganAt: beganAt ?? null, endedAt: endedAt ?? null },
      completeness: usable ? 'unverified' : 'unmeasured',
      diagnosticError: problem ?? (heap === undefined ? `main heap identification found ${heaps.size} distinct full-sweep heaps` : null),
      ambiguousFragments,
      markerAmbiguousSegments,
      unparseablePauses,
      suppressedFragments,
      windowSuppressedFragments,
      samples: usable ? samples.length : 0,
      sampleP50Ms: percentile(0.5),
      sampleP99Ms: percentile(0.99),
      sampleMaxMs: usable ? (samples.at(-1) ?? null) : null,
    })}\n`,
  );
}
