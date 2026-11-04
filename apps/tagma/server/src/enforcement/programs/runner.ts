import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { isAbsolute, join, matchesGlob } from 'node:path';
import { plugin } from 'bun';
import type { ProgramAnswer, ProgramInvocation, ProgramKey, ProgramResult, ProgramSide } from '@tagma/inspection/program';
import type { Answer, Program, Reading, Side } from '@runlith/tagma/rules';
import * as rules from '@runlith/tagma/rules';
import * as effect from '@runlith/tagma/rules/effect';

const input: ProgramInvocation = JSON.parse(await Bun.stdin.text());
const module = process.argv[2];

function said(answer: Omit<ProgramAnswer, 'request' | 'tree' | 'base' | 'checker' | 'run'>): never {
  const whole: ProgramAnswer = {
    request: input.request,
    tree: input.tree,
    base: input.base,
    checker: input.checker,
    run: { tool: 'tagma', version: Bun.version, capabilities: {} },
    ...answer,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(whole)}\n`);
  for (let written = 0; written < bytes.length;) written += writeSync(1, bytes, written);
  process.exit(0);
}

function failed(failure: string): never {
  said({ readings: [], failure });
}

const git = (args: readonly string[]): Buffer | null => {
  const ran = spawnSync('git', ['-C', input.root, ...args], { maxBuffer: 1024 * 1024 * 1024 });
  if (ran.error !== undefined) failed(`git could not run: ${ran.error.message}`);
  return ran.status === 0 ? ran.stdout : null;
};

const isReading = (value: unknown): value is Reading => {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as Reading).findings)) return false;
  const covered = (value as Reading).covered;
  return (
    covered === undefined ||
    covered === 'paths' ||
    covered === 'reach' ||
    (Array.isArray(covered) && covered.every((path) => typeof path === 'string'))
  );
};

const answered = (value: unknown): value is Answer =>
  typeof value === 'object' &&
  value !== null &&
  isReading((value as Answer).tree) &&
  ((value as Answer).base === undefined || isReading((value as Answer).base));

const inReach = (key: ProgramKey, path: string): boolean =>
  key.reach.places.some((place) => place === '' || path === place || path.startsWith(`${place}/`)) &&
  (key.reach.files === undefined || key.reach.files.some((glob) => matchesGlob(path, glob)));

plugin({
  name: 'tagma-sdk',
  setup(build) {
    build.module('@runlith/tagma/rules', () => ({ exports: rules, loader: 'object' }));
    build.module('@runlith/tagma/rules/effect', () => ({ exports: effect, loader: 'object' }));
  },
});

if (module === undefined) failed('the runner was started without a program module');
const loaded: { readonly default?: unknown } = await import(isAbsolute(module) ? module : join(input.root, module));
const programs = loaded.default;
if (typeof programs !== 'object' || programs === null) failed(`${module} has no defineProgram default export`);

const SOURCE_MODES: ReadonlySet<string> = new Set(['100644', '100755']);

const listed = new Map<string, readonly string[]>();
const listing = (commit: string): readonly string[] => {
  const held = listed.get(commit);
  if (held !== undefined) return held;
  const out = git(['ls-tree', '-r', '-z', commit]);
  if (out === null) failed(`git could not list ${commit}`);
  const paths = out
    .toString()
    .split('\0')
    .flatMap((row) => {
      const entry = /^(\d+) blob [0-9a-f]+\t([\s\S]+)$/u.exec(row);
      return entry !== null && SOURCE_MODES.has(entry[1]!) ? [entry[2]!] : [];
    });
  listed.set(commit, paths);
  return paths;
};

const sideOf = (side: ProgramSide, key: ProgramKey): Side => {
  const commit = side.side === 'tree' ? input.tree : (input.base ?? failed('a base side was asked without a base'));
  const given = new Map((side.files ?? []).map((file) => [file.path, file.text]));
  const unread = new Map((side.unread ?? []).map((file) => [file.path, file.reason]));
  return {
    commit,
    whole: side.paths === null,
    paths: (side.paths ?? listing(commit)).filter((path) => inReach(key, path)),
    facts: input.facts?.sides.find((one) => one.side === side.side) ?? null,
    read: async (path) => {
      const reason = unread.get(path);
      if (reason !== undefined) throw new Error(reason);
      const known = given.get(path);
      if (known !== undefined) return known;
      const out = git(['cat-file', 'blob', `${commit}:${path}`]);
      return out === null ? null : new TextDecoder('utf-8', { fatal: true }).decode(out);
    },
  };
};

const readings: ProgramResult[] = [];
const unanswered: NonNullable<ProgramAnswer['unanswered']>[number][] = [];
for (const key of input.keys) {
  const program: unknown = (programs as Readonly<Record<string, unknown>>)[key.id];
  if (typeof program !== 'function') failed(`${module} declares no program ${key.id}`);
  const sides = new Map(input.sides.map((side) => [side.side, side]));
  const tree = sideOf(sides.get('tree')!, key);
  const base = sides.has('base') ? sideOf(sides.get('base')!, key) : null;
  let answer: unknown;
  try {
    answer = await (program as Program<object>)({ params: key.params, tree, base, mode: input.mode });
  } catch (error) {
    const unprepared = error instanceof Error && error.name === 'NeedsPreparation';
    const reason = error instanceof Error ? (unprepared ? error.message : (error.stack ?? error.message)) : String(error);
    unanswered.push({
      key: key.key,
      why: unprepared ? 'unprepared' : 'threw',
      reason: reason === '' ? 'it threw with no message' : reason,
    });
    continue;
  }
  if (!answered(answer)) failed(`${key.id} of ${module} answered no { tree: { findings }, base? } reading`);
  for (const side of input.sides) {
    const reading = side.side === 'tree' ? answer.tree : answer.base;
    const judged = side.side === 'tree' ? tree : base!;
    readings.push({
      key: key.key,
      side: side.side,
      remeasure: reading?.remeasure,
      covered:
        reading?.covered === 'reach' || judged.whole
          ? { scope: 'reach' }
          : Array.isArray(reading?.covered)
            ? reading.covered
            : judged.paths,
      findings: reading?.findings ?? [],
      unjudged: [],
    });
  }
}
said({ readings, unanswered: unanswered.length === 0 ? undefined : unanswered });
