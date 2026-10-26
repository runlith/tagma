import { statSync, realpathSync } from 'node:fs';
import { basename, parse, resolve, sep } from 'node:path';
import type { ProcessFacts } from './ProcessReader';

export type ProgramRule = {
  readonly words: ReadonlyArray<string>;
  readonly folder?: string | undefined;
};

export type ProgramLookups = {
  readonly isFile: (path: string) => boolean;
  readonly realPath: (path: string) => string | undefined;
};

export type ProgramMatch<R extends ProgramRule> =
  | { readonly _tag: 'Matched'; readonly rule: R; readonly index: number }
  | { readonly _tag: 'None' }
  | { readonly _tag: 'Unread'; readonly fields: ReadonlyArray<'args' | 'folder'> };

export const INTERPRETERS: ReadonlySet<string> = new Set(['node', 'bun', 'deno', 'python', 'python3', 'ruby', 'perl', 'sh', 'bash', 'zsh']);

const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh']);

export const diskLookups: ProgramLookups = {
  isFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  realPath: (path) => {
    try {
      return realpathSync.native(path);
    } catch {
      return undefined;
    }
  },
};

type Candidate = { readonly name: string; readonly at: number };

const commandFlag = (arg: string): boolean => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg);

const scriptOf = (args: ReadonlyArray<string>, folder: string, shell: boolean, lookups: ProgramLookups): Candidate | undefined => {
  for (let at = 1; at < args.length; at++) {
    const arg = args[at]!;
    if (shell && commandFlag(arg)) return undefined;
    if (arg === '-m') {
      const module = args[at + 1];
      return module === undefined ? undefined : { name: module, at: at + 1 };
    }
    if (arg.startsWith('-')) continue;
    if (lookups.isFile(resolve(folder, arg))) return { name: parse(arg).name, at };
  }
  return undefined;
};

const candidatesOf = (
  args: ReadonlyArray<string>,
  executable: string | undefined,
  folder: string,
  lookups: ProgramLookups,
): ReadonlyArray<Candidate> => {
  const names = [args[0], executable].filter((name): name is string => name !== undefined).map((name) => basename(name));
  const own = names.map((name) => ({ name, at: 0 }));
  const interpreter = names.find((name) => INTERPRETERS.has(name));
  if (interpreter === undefined) return own;
  const script = scriptOf(args, folder, SHELLS.has(interpreter), lookups);
  return script === undefined ? own : [...own, script];
};

const wordsFollow = (args: ReadonlyArray<string>, from: number, words: ReadonlyArray<string>): boolean => {
  let next = 1;
  for (let at = from + 1; at < args.length && next < words.length; at++) {
    if (args[at] === words[next]) next++;
  }
  return next === words.length;
};

const covers = (ruleFolder: string, processFolder: string): boolean =>
  processFolder === ruleFolder || processFolder.startsWith(ruleFolder.endsWith(sep) ? ruleFolder : ruleFolder + sep);

export const matchProgram = <R extends ProgramRule>(
  process: Pick<ProcessFacts, 'args' | 'executable' | 'folder'>,
  rules: ReadonlyArray<R>,
  root: string,
  lookups: ProgramLookups,
): ProgramMatch<R> => {
  const unread = [
    ...(process.args._tag === 'Unreadable' ? (['args'] as const) : []),
    ...(process.folder._tag === 'Unreadable' ? (['folder'] as const) : []),
  ];
  if (process.args._tag === 'Unreadable' || process.folder._tag === 'Unreadable') return { _tag: 'Unread', fields: unread };
  const args = process.args.value;
  const folder = process.folder.value;
  if (args.length === 0) return { _tag: 'None' };
  const executable = process.executable._tag === 'Read' ? process.executable.value : undefined;
  const candidates = candidatesOf(args, executable, folder, lookups);
  let realFolder: string | undefined | null = null;
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index]!;
    const program = rule.words[0];
    if (program === undefined) continue;
    const matched = candidates.some((candidate) => candidate.name === program && wordsFollow(args, candidate.at, rule.words));
    if (!matched) continue;
    if (rule.folder !== undefined) {
      if (realFolder === null) realFolder = lookups.realPath(folder);
      const ruleFolder = lookups.realPath(resolve(root, rule.folder));
      if (realFolder === undefined || ruleFolder === undefined || !covers(ruleFolder, realFolder)) continue;
    }
    return { _tag: 'Matched', rule, index };
  }
  return { _tag: 'None' };
};

export type ListedRule = ProgramRule & { readonly list: number; readonly limitMs: number };

export const matchTightest = <R extends ListedRule>(
  process: Pick<ProcessFacts, 'args' | 'executable' | 'folder'>,
  rules: ReadonlyArray<R>,
  root: string,
  lookups: ProgramLookups,
): ProgramMatch<R> => {
  let chosen: { readonly rule: R; readonly index: number } | undefined;
  for (const list of new Set(rules.map((rule) => rule.list))) {
    const indices = rules.flatMap((rule, index) => (rule.list === list ? [index] : []));
    const match = matchProgram(
      process,
      indices.map((index) => rules[index]!),
      root,
      lookups,
    );
    if (match._tag === 'Unread') return match;
    if (match._tag === 'None') continue;
    const rule = match.rule;
    if (
      chosen === undefined ||
      rule.limitMs < chosen.rule.limitMs ||
      (rule.limitMs === chosen.rule.limitMs && rule.list > chosen.rule.list)
    ) {
      chosen = { rule, index: indices[match.index]! };
    }
  }
  return chosen === undefined ? { _tag: 'None' } : { _tag: 'Matched', ...chosen };
};
