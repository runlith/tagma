import { appendFileSync, existsSync, watch, type FSWatcher } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`missing ${name}`);
  return value;
};

const absolute = (name: string): string => {
  const value = argument(name);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
};

const go = absolute('--go');
const report = absolute('--report');
const interval = Number(argument('--interval'));
if (!Number.isFinite(interval) || interval <= 0) throw new Error('--interval must be positive and finite');

let id = 0;
let nextAt = 0;
let startMono = 0;
let startWall = 0;
let started = false;
let stopped = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let watcher: FSWatcher | undefined;

const tick = (): void => {
  timer = undefined;
  if (stopped) return;
  appendFileSync(report, `${JSON.stringify({ id: id++, scheduledAt: startWall + (nextAt - startMono), offeredAt: Date.now() })}\n`);
  nextAt += interval;
  timer = setTimeout(tick, Math.max(0, nextAt - performance.now()));
};

const start = (): void => {
  if (started || stopped || !existsSync(go)) return;
  started = true;
  watcher?.close();
  watcher = undefined;
  startWall = Date.now();
  startMono = performance.now();
  nextAt = startMono;
  tick();
};

const stop = (): void => {
  stopped = true;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  watcher?.close();
  watcher = undefined;
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
watcher = watch(dirname(go), start);
start();
