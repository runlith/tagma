import { basename, isAbsolute, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { Effect } from 'effect';
import type { ToolShown } from '@runlith/agent/tool';
import { shellCommands, type ShellWord } from './shellCommands';
import { gitOperation, withoutPrefixes } from './shellShapes';

export type ShellSight = {
  readonly command: string;
  readonly output: string;
  readonly cwd: string;
  readonly root: string;
};

const LINE_SITE = /^(.+?)[:-]\d+[:-]/;
const DIFF_HEAD = /^diff --git ("(?:\\.|[^"])*"|a\/.+) ("(?:\\.|[^"])*"|b\/.+)$/;
const PROBES_AT_ONCE = 8;
const SEARCHES = new Set(['rg', 'grep', 'egrep', 'fgrep']);
const EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
const EVALUATORS = new Set(['bun', 'node', 'swift']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const SEARCH_VALUES = new Set([
  '-g',
  '--glob',
  '--iglob',
  '-t',
  '--type',
  '-T',
  '--type-not',
  '--encoding',
  '-m',
  '--max-count',
  '-A',
  '--after-context',
  '-B',
  '--before-context',
  '-C',
  '--context',
  '-r',
  '--replace',
  '-j',
  '--threads',
  '--sort',
  '--sortr',
  '--pre',
  '--pre-glob',
]);
const PATTERNS = new Set(['-e', '--regexp']);
const PATTERN_FILES = new Set(['-f', '--file']);

const codeFlag = (program: string, flag: string): boolean =>
  (EVALUATORS.has(program) && EVAL_FLAGS.has(flag)) ||
  ((SHELLS.has(program) || /^python(?:\d+(?:\.\d+)*)?$/.test(program)) && flag === '-c') ||
  ((program === 'perl' || program === 'ruby') && (flag === '-e' || flag === '-E'));
type ArgumentRole = 'data' | 'file';
const NODE_OPTIONS: Readonly<Record<string, ArgumentRole>> = {
  '-r': 'file',
  '--require': 'file',
  '--import': 'file',
  '--loader': 'file',
  '--experimental-loader': 'file',
  '-C': 'data',
  '--conditions': 'data',
  '--input-type': 'data',
  '--title': 'data',
  '--inspect-port': 'data',
};
const interpreterValue = (program: string, flag: string): ArgumentRole | undefined => {
  if (program === 'node') return NODE_OPTIONS[flag];
  if (SHELLS.has(program) && (flag === '-o' || flag === '-O')) return 'data';
  if (/^python(?:\d+(?:\.\d+)*)?$/.test(program) && (flag === '-W' || flag === '-X')) return 'data';
  if ((program === 'ruby' || program === 'perl') && (flag === '-I' || flag === '-r')) return 'file';
  return undefined;
};
const SWIFT_COMMANDS = new Set(['test', 'build', 'package', 'run', 'repl']);
const SWIFT_VALUES = new Set(['-j', '--jobs', '-c', '--configuration', '--filter', '--skip', '--num-workers', '--parallel-workers']);
const JQ_BINDINGS = new Set(['--arg', '--argjson']);
const JQ_FILES = new Set(['--slurpfile', '--rawfile', '--argfile']);
const SCRIPT_ARGS = new Set(['node', 'swift', 'perl', 'ruby', ...SHELLS]);
const AWKS = new Set(['awk', 'gawk', 'mawk', 'nawk']);
const EDITORS = new Set(['sed', 'gsed']);
const LAUNCHES = 3;

const python = (program: string): boolean => /^python(?:\d+(?:\.\d+)*)?$/.test(program);

const runsCode = (program: string): boolean =>
  SCRIPT_ARGS.has(program) || EVALUATORS.has(program) || AWKS.has(program) || EDITORS.has(program) || python(program);

const LAUNCHERS = new Set(['nice', 'nohup', 'timeout', 'gtimeout', 'time', 'xargs', 'sudo', 'doas', 'stdbuf', 'caffeinate', 'flock']);

type ProgramOption = { readonly role: 'program' | 'source' | 'data'; readonly attached: string | null };

const AWK_LONG: Readonly<Record<string, ProgramOption['role']>> = {
  '--file': 'program',
  '--source': 'source',
  '--field-separator': 'data',
  '--assign': 'data',
};
const AWK_SHORT: Readonly<Record<string, ProgramOption['role']>> = { f: 'program', e: 'source', F: 'data', v: 'data' };
const SED_LONG: Readonly<Record<string, ProgramOption['role']>> = { '--file': 'program', '--expression': 'source' };
const SED_SHORT: Readonly<Record<string, ProgramOption['role']>> = { f: 'program', e: 'source' };

const programOption = (program: string, flag: string): ProgramOption | null => {
  const awk = AWKS.has(program);
  if (!awk && !EDITORS.has(program)) return null;
  if (flag.startsWith('--')) {
    const equals = flag.indexOf('=');
    const role = (awk ? AWK_LONG : SED_LONG)[equals < 0 ? flag : flag.slice(0, equals)];
    return role === undefined ? null : { role, attached: equals < 0 ? null : flag.slice(equals + 1) };
  }
  const role = (awk ? AWK_SHORT : SED_SHORT)[flag.slice(1, 2)];
  return role === undefined ? null : { role, attached: flag.length > 2 ? flag.slice(2) : null };
};

const startsCode = (program: string, next: ShellWord | undefined): boolean => {
  if (next === undefined || !next.literal || !next.text.startsWith('-')) return false;
  const equals = next.text.indexOf('=');
  const option = equals < 0 ? next.text : next.text.slice(0, equals);
  const sourced = programOption(program, next.text)?.role;
  return codeFlag(program, option) || sourced === 'program' || sourced === 'source';
};
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const NUL = /\u0000/;

const jsonData = (word: string): boolean => {
  if (!/^[{\[]/.test(word)) return false;
  try {
    JSON.parse(word);
    return true;
  } catch (failure) {
    if (failure instanceof SyntaxError) return false;
    throw failure;
  }
};

const C_ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });

const diffPath = (word: string, side: 'a' | 'b'): string | null => {
  let path = word;
  if (word.startsWith('"')) {
    const bytes: number[] = [];
    for (const part of word.slice(1, -1).match(/\\[0-7]{3}|\\.|[^\\]+/g) ?? []) {
      if (!part.startsWith('\\')) {
        for (const byte of ENCODER.encode(part)) bytes.push(byte);
      } else if (/^\\[0-7]{3}$/.test(part)) bytes.push(Number.parseInt(part.slice(1), 8));
      else {
        const byte = C_ESCAPES[part.slice(1)];
        if (byte === undefined) return null;
        bytes.push(byte);
      }
    }
    try {
      path = DECODER.decode(Uint8Array.from(bytes));
    } catch (failure) {
      if (failure instanceof TypeError) return null;
      throw failure;
    }
  }
  return path.startsWith(`${side}/`) ? path.slice(2) : null;
};

const argumentForms = (word: string, revision: boolean): readonly string[] => {
  const colon = revision ? word.indexOf(':') : -1;
  return colon <= 0 ? [word] : [word, word.slice(colon + 1)];
};

type SearchOutput = {
  readonly cwd: string;
  readonly operands: readonly string[];
  readonly filenames: boolean | 'auto';
};

type ShellNames = {
  readonly files: ReadonlyMap<string, ToolShown['as']>;
  readonly searches: readonly SearchOutput[];
  readonly diffs: boolean;
};

const named = (sight: ShellSight): ShellNames => {
  const said = new Map<string, ToolShown['as']>();
  const take = (at: string, written: string, as: ToolShown['as']) => {
    if (written === '' || written.startsWith('-') || URI.test(written) || NUL.test(written) || jsonData(written)) return;
    const path = isAbsolute(written) ? written : resolve(at, written);
    if (said.get(path) !== 'read') said.set(path, as);
  };
  let at = sight.cwd;
  const searches: SearchOutput[] = [];
  let diffs = false;
  const scan = (words: readonly ShellWord[], piped: boolean): number | null => {
    const [program, ...rest] = words;
    if (program === undefined || !program.literal) return null;
    const name = basename(program.text);
    if (name === 'cd') {
      const into = rest[0];
      if (into !== undefined && into.literal && !into.text.startsWith('~')) at = resolve(at, into.text);
      return null;
    }
    const git = name === 'git' ? gitOperation(words) : null;
    const verb = git === null ? null : words[git.at]?.text;
    const here = git === null ? at : git.within.reduce((at, into) => resolve(at, into), at);
    const offset = git === null ? 1 : git.at + 1;
    const args = words.slice(offset);
    const search = SEARCHES.has(name) || verb === 'grep';
    const launcher = git === null && !search && name !== 'jq' && name !== 'sqlite3' && !runsCode(name);
    const searchPaths: string[] = [];
    let filenames: SearchOutput['filenames'] = verb === 'grep' ? true : 'auto';
    const revision = verb === 'show' || verb === 'diff';
    diffs ||= revision || (verb === 'log' && args.some((word) => word.literal && (word.text === '-p' || word.text === '--patch')));
    let values: ArgumentRole[] = [];
    let pattern = search || name === 'jq' || AWKS.has(name) || EDITORS.has(name);
    let operands: 'files' | 'script' | 'database' | 'data' =
      name === 'sqlite3' ? 'database' : SCRIPT_ARGS.has(name) || python(name) ? 'script' : 'files';
    let flags = true;
    let backup = false;
    for (const [index, word] of args.entries()) {
      const suffix = backup;
      backup = false;
      if (suffix && word.literal && word.text === '') continue;
      const value = values.shift();
      if (value !== undefined) {
        if (value === 'file' && word.literal) take(here, word.text, 'read');
        continue;
      }
      if (flags && word.literal && word.text === '--') {
        flags = false;
        continue;
      }
      if (flags && word.literal && word.text.startsWith('-')) {
        const flag = word.text;
        const equals = flag.indexOf('=');
        const option = equals < 0 ? flag : flag.slice(0, equals);
        const role = interpreterValue(name, option);
        const sourced = programOption(name, flag);
        if (EDITORS.has(name) && (flag === '-i' || flag === '-I')) backup = true;
        else if (sourced !== null) {
          if (sourced.role !== 'data') pattern = false;
          if (sourced.attached === null) values = [sourced.role === 'program' ? 'file' : 'data'];
          else if (sourced.role === 'program') take(here, sourced.attached, 'read');
        } else if (codeFlag(name, option)) {
          values = equals < 0 ? ['data'] : [];
          operands = 'data';
        } else if (role !== undefined) {
          if (equals < 0) values = [role];
          else if (role === 'file') take(here, flag.slice(equals + 1), 'read');
        } else if ((search && SEARCH_VALUES.has(flag)) || (name === 'swift' && SWIFT_VALUES.has(flag))) values = ['data'];
        else if (
          (search && (PATTERNS.has(flag) || PATTERN_FILES.has(flag))) ||
          (name === 'jq' && (flag === '-f' || flag === '--from-file'))
        ) {
          pattern = false;
          values = [PATTERN_FILES.has(flag) || name === 'jq' ? 'file' : 'data'];
        } else if (search && /^(?:-e.|--regexp=)/.test(flag)) pattern = false;
        else if (search && flag === '--with-filename') filenames = true;
        else if (search && flag === '--no-filename') filenames = false;
        else if (search && /^-[^-]/.test(flag)) {
          for (const letter of flag.slice(1)) {
            if (letter === 'H') filenames = true;
            else if (letter === 'h') filenames = false;
          }
        } else if (name === 'jq' && JQ_BINDINGS.has(flag)) values = ['data', 'data'];
        else if (name === 'jq' && JQ_FILES.has(flag)) values = ['data', 'file'];
        else if (name === 'jq' && (flag === '--args' || flag === '--jsonargs')) operands = 'data';
        continue;
      }
      if (pattern) {
        pattern = false;
        continue;
      }
      if (launcher && word.literal) {
        const inner = basename(word.text);
        if (runsCode(inner) && (LAUNCHERS.has(name) || startsCode(inner, args[index + 1]))) return offset + index;
      }
      if (name === 'swift' && word.literal && SWIFT_COMMANDS.has(word.text)) operands = 'data';
      if (operands === 'data') continue;
      if (word.literal && word.text !== ':memory:') {
        for (const form of argumentForms(word.text, revision)) take(here, form, 'read');
        if (search) searchPaths.push(resolve(here, word.text));
      }
      if (operands === 'script' || operands === 'database') {
        operands = 'data';
        flags = false;
      }
    }
    if (search && !piped) searches.push({ cwd: here, operands: searchPaths, filenames });
    return null;
  };
  for (const command of shellCommands(sight.command) ?? []) {
    let words = withoutPrefixes(command.words);
    for (let launched = 0; launched <= LAUNCHES; launched += 1) {
      const inner = scan(words, command.piped);
      if (inner === null) break;
      words = words.slice(inner);
    }
  }
  return { files: said, searches, diffs };
};

const printed = (sight: ShellSight, names: ShellNames, read: readonly ToolShown[]): ReadonlyMap<string, ToolShown['as']> => {
  const files = new Set(read.map((one) => one.path));
  const searches = names.searches.filter(
    (search) =>
      search.filenames !== false && (search.filenames === true || search.operands.length !== 1 || !files.has(search.operands[0]!)),
  );
  const said = new Map<string, ToolShown['as']>();
  const take = (at: string, written: string) => {
    if (written === '' || NUL.test(written)) return;
    const path = isAbsolute(written) ? written : resolve(at, written);
    if (!names.files.has(path)) said.set(path, 'found');
  };
  if (searches.length === 0 && !names.diffs) return said;
  for (const raw of sight.output.split('\n')) {
    const line = raw.includes('\u001b') ? stripVTControlCharacters(raw) : raw;
    const diff = names.diffs ? DIFF_HEAD.exec(line) : null;
    if (diff !== null) {
      const from = diffPath(diff[1]!, 'a');
      const into = diffPath(diff[2]!, 'b');
      if (from !== null) take(sight.root, from);
      if (into !== null) take(sight.root, into);
      continue;
    }
    const site = searches.length > 0 ? LINE_SITE.exec(line) : null;
    if (site !== null) for (const search of searches) take(search.cwd, site[1]!);
  }
  return said;
};

export type SearchSight = {
  readonly found: readonly string[];
  readonly output: string;
  readonly cwd: string;
};

const SEARCH_HIT = /^([^:]+):/;

const searched = (sight: SearchSight): ReadonlyMap<string, ToolShown['as']> => {
  const said = new Map<string, ToolShown['as']>();
  const take = (written: string) => {
    if (written !== '' && !NUL.test(written)) said.set(isAbsolute(written) ? written : resolve(sight.cwd, written), 'found');
  };
  for (const path of sight.found) take(path);
  for (const raw of sight.output.split('\n')) {
    const line = raw.includes('\u001b') ? stripVTControlCharacters(raw) : raw;
    for (const site of [LINE_SITE.exec(line), SEARCH_HIT.exec(line)]) if (site !== null) take(site[1]!);
  }
  return said;
};

const probed = Effect.fnUntraced(function* <E>(
  named: ReadonlyMap<string, ToolShown['as']>,
  isFile: (path: string) => Effect.Effect<boolean, E>,
): Effect.fn.Return<readonly ToolShown[], E> {
  const candidates = [...named];
  const files = yield* Effect.forEach(candidates, ([path]) => isFile(path), { concurrency: PROBES_AT_ONCE });
  return candidates.flatMap(([path, as], at) => (files[at] === true ? [{ path, as }] : []));
});

export const shellShown = Effect.fnUntraced(function* <E>(sight: ShellSight, isFile: (path: string) => Effect.Effect<boolean, E>) {
  const names = named(sight);
  const read = yield* probed(names.files, isFile);
  const found = yield* probed(printed(sight, names, read), isFile);
  return [...read, ...found];
});

export const searchShown = <E>(sight: SearchSight, isFile: (path: string) => Effect.Effect<boolean, E>) => probed(searched(sight), isFile);
