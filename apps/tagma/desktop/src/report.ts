import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { copyFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { RESTART_RECORD } from '@tagma/server/installation/contract/wire/restart';

export type ReportFacts = {
  readonly name: string;
  readonly build: string | null;
  readonly data: string | null;
  readonly log: string | null;
};

export type Composition = {
  readonly text: string;
  readonly segment: readonly string[];
  readonly bytes: number;
};

const LOG_TAIL_BYTES = 512 * 1024;
const RECORD_BYTES = 256 * 1024;
const SEGMENTS = join('performance', 'segments');
const SEGMENT = /^\d+\.sqlite$/u;

const said = (file: string, args: readonly string[]): Promise<string> =>
  new Promise((answered) =>
    execFile(file, [...args], { timeout: 5_000 }, (error, stdout) => answered(error === null ? stdout.trim() : `unread: ${error.message}`)),
  );

const tail = async (path: string, bytes: number): Promise<string> => {
  const file = await open(path, 'r').catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
  if (file === null) return `${path} does not exist`;
  try {
    const { size } = await file.stat();
    const from = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - from);
    await file.read(buffer, 0, buffer.length, from);
    return `${from > 0 ? `… the first ${from} bytes are left out\n` : ''}${buffer.toString('utf8')}`;
  } finally {
    await file.close();
  }
};

const lastSegment = (data: string | null): readonly string[] => {
  const at = data === null ? null : join(data, SEGMENTS);
  if (at === null || !existsSync(at)) return [];
  const newest = readdirSync(at)
    .filter((name) => SEGMENT.test(name))
    .sort((one, other) => Number.parseInt(other, 10) - Number.parseInt(one, 10))[0];
  if (newest === undefined) return [];
  return [join(at, newest), join(at, `${newest}-wal`)].filter((path) => existsSync(path));
};

export async function composed(facts: ReportFacts): Promise<Composition> {
  const [system, model] = await Promise.all([said('/usr/bin/sw_vers', ['-productVersion']), said('/usr/sbin/sysctl', ['-n', 'hw.model'])]);
  const sections = [
    `${facts.name} ${facts.build ?? '(no release)'}`,
    `macOS ${system} · ${model} · ${process.arch}`,
    `written ${new Date().toISOString()}`,
    '',
    '== how Tagma last started ==',
    facts.data === null ? 'no data directory' : await tail(join(facts.data, RESTART_RECORD), RECORD_BYTES),
    '',
    '== the server log ==',
    facts.log === null ? 'no server log' : await tail(facts.log, LOG_TAIL_BYTES),
  ];
  const text = `${sections.join('\n')}\n`;
  const segment = lastSegment(facts.data);
  return { text, segment, bytes: Buffer.byteLength(text) + segment.reduce((sum, path) => sum + statSync(path).size, 0) };
}

const zipped = (from: string, to: string): Promise<void> =>
  new Promise((done, failed) => execFile('/usr/bin/ditto', ['-c', '-k', from, to], (error) => (error === null ? done() : failed(error))));

export async function writeReport(path: string, composition: Composition): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'tagma-report-'));
  try {
    await writeFile(join(folder, 'report.txt'), composition.text);
    for (const part of composition.segment) await copyFile(part, join(folder, basename(part)));
    await zipped(folder, path);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
