import { basename, isAbsolute } from 'node:path';
import { shellCommands, type ShellCommand, type ShellWord } from './shellCommands';
import { findMutation } from './shellFind';

export type ShellSweepShape = {
  readonly code: 'shared-checkout';
  readonly shape: 'git commit' | 'git add --all' | 'git stash' | 'git reset --hard' | 'git checkout .' | 'git restore .' | 'git clean';
  readonly reason: string;
  readonly within?: readonly string[];
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const WRAPPING_LIMIT = 3;
const MOVES = new Set(['cd', 'pushd', 'popd']);

function verbName(word: ShellWord | undefined): string | null {
  if (word === undefined || !word.literal) return null;
  return word.text.includes('/') ? basename(word.text) : word.text;
}

export function withoutPrefixes(words: readonly ShellWord[]): readonly ShellWord[] {
  let rest = words;
  for (;;) {
    const name = verbName(rest[0]);
    if (name === 'command' || name === 'builtin' || name === 'exec') {
      let at = 1;
      while (rest[at]?.literal && rest[at]?.text.startsWith('-')) {
        const flag = rest[at]!.text;
        if (name === 'command' && (flag === '-v' || flag === '-V')) return [];
        at += name === 'exec' && flag === '-a' ? 2 : 1;
        if (flag === '--') break;
      }
      rest = rest.slice(at);
      continue;
    }
    if (name === 'env') {
      let at = 1;
      while (rest[at]?.literal) {
        const text = rest[at]!.text;
        if (text === '-C' || text.startsWith('--chdir')) return [];
        if (text === '--') {
          at += 1;
          break;
        }
        if (ASSIGNMENT.test(text)) at += 1;
        else if (text.startsWith('-')) at += text === '-u' || text === '--unset' ? 2 : 1;
        else break;
      }
      rest = rest.slice(at);
      continue;
    }
    return rest;
  }
}

const COMMIT_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git commit',
  reason:
    "A bare git commit takes the whole shared index, a neighbour's staged entries included; `submit_work` lands only this session's own lines.",
};

const AMEND_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git commit',
  reason: "git commit --amend rewrites the last commit with the whole shared index, a neighbour's staged entries included.",
};

const ADD_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git add --all',
  reason: "git add -A/--all stages every change of the shared checkout, including a neighbour's. Stage your own paths: `git add <paths>`.",
};

const STASH_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git stash',
  reason: "A bare git stash takes every unfinished change of the shared checkout, including a neighbour's. Leave the tree in place.",
};

const RESET_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git reset --hard',
  reason:
    "git reset --hard throws away every unfinished change of the shared working tree, including a neighbour's. Reset your own paths: `git reset --hard -- <paths>`.",
};

const CHECKOUT_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git checkout .',
  reason:
    "git checkout . throws away every unfinished change of the shared working tree, including a neighbour's. Name your own paths: `git checkout -- <paths>`.",
};

const RESTORE_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git restore .',
  reason:
    "git restore . throws away every unfinished change of the shared working tree, including a neighbour's. Name your own paths: `git restore <paths>`.",
};

const CLEAN_SWEEP: ShellSweepShape = {
  code: 'shared-checkout',
  shape: 'git clean',
  reason:
    "git clean removes every untracked path of the shared checkout, including a neighbour's. Name your own paths: `git clean <paths>`.",
};

const STASH_READS = new Set(['list', 'show']);

function pathsAfter(args: readonly ShellWord[]): readonly ShellWord[] | null {
  const at = args.findIndex((word) => word.literal && word.text === '--');
  return at === -1 ? null : args.slice(at + 1);
}

function boundedByPaths(words: readonly ShellWord[]): boolean {
  return words.some((word) => word.text !== '');
}

function resetSweep(args: readonly ShellWord[]): ShellSweepShape | null {
  const separator = args.findIndex((word) => word.literal && word.text === '--');
  const modes = separator === -1 ? args : args.slice(0, separator);
  if (!modes.some((word) => word.literal && word.text === '--hard')) return null;
  if (separator !== -1 && boundedByPaths(args.slice(separator + 1))) return null;
  return RESET_SWEEP;
}

function wholeTreePath(args: readonly ShellWord[]): boolean {
  const operands = pathsAfter(args) ?? args.filter((word) => !word.text.startsWith('-'));
  const named = operands.filter((word) => word.text !== '');
  return named.length === 1 && named[0]?.literal === true && named[0].text === '.';
}

function cleanSweep(args: readonly ShellWord[]): ShellSweepShape | null {
  const dry = args.some(
    (word) => (word.literal && word.text === '--dry-run') || (word.literal && /^-[A-Za-z]+$/.test(word.text) && word.text.includes('n')),
  );
  if (dry) return null;
  const separated = pathsAfter(args);
  if (separated !== null) return boundedByPaths(separated) ? null : CLEAN_SWEEP;
  const operands: ShellWord[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at] as ShellWord;
    if (word.text === '-e' || word.text === '--exclude') {
      at += 1;
      continue;
    }
    if (word.text.startsWith('-')) continue;
    operands.push(word);
  }
  return boundedByPaths(operands) ? null : CLEAN_SWEEP;
}

type GitCall = {
  readonly operation: string;
  readonly args: readonly ShellWord[];
  readonly within: readonly string[];
};

function moveOperand(words: readonly ShellWord[], inPipeline: boolean): string | null {
  const verb = verbName(words[0]);
  const operands = words.slice(1);
  const arg = verb !== 'popd' && operands.length === 1 ? operands[0] : undefined;
  if (inPipeline || arg === undefined || !arg.literal || arg.text === '') return null;
  return isAbsolute(arg.text) || arg.text.startsWith('.') ? arg.text : null;
}

function gitCalls(text: string, depth: number, moved: readonly string[]): readonly GitCall[] | null {
  const commands = shellCommands(text);
  if (commands === null) return null;
  const calls: GitCall[] = [];
  let within = moved;
  for (const [at, command] of commands.entries()) {
    const words = withoutPrefixes(command.words);
    const verb = verbName(words[0]);
    if (verb !== null && MOVES.has(verb)) {
      const to = moveOperand(words, command.piped || commands[at + 1]?.piped === true);
      if (to !== null) within = [...within, to];
      continue;
    }
    if (verb !== null && SHELLS.has(verb) && depth < WRAPPING_LIMIT) {
      const flag = words.findIndex((word) => word.text === '-c');
      const inner = flag === -1 ? undefined : words[flag + 1];
      if (inner !== undefined) calls.push(...(gitCalls(inner.text, depth + 1, within) ?? []));
      continue;
    }
    if (verb !== 'git') continue;
    const found = gitOperation(words);
    if (found === null) continue;
    calls.push({ operation: (words[found.at] as ShellWord).text, args: words.slice(found.at + 1), within: [...within, ...found.within] });
  }
  return calls;
}

const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

export function gitOperation(words: readonly ShellWord[]): { readonly at: number; readonly within: readonly string[] } | null {
  const within: string[] = [];
  for (let at = 1; at < words.length; at += 1) {
    const word = words[at] as ShellWord;
    if (!word.literal) return null;
    if (GIT_VALUED.has(word.text)) {
      const value = words[at + 1];
      if (word.text === '-C' && value?.literal === true) within.push(value.text);
      at += 1;
      continue;
    }
    if (!word.text.startsWith('-')) return { at, within };
  }
  return null;
}

function gitSweep(operation: string, args: readonly ShellWord[]): ShellSweepShape | null {
  if (operation === 'stash') {
    const named = args.find((word) => !word.text.startsWith('-'));
    return named?.literal === true && STASH_READS.has(named.text) ? null : STASH_SWEEP;
  }
  if (operation === 'add') {
    for (const word of args) {
      if (!word.literal || word.text === '--') break;
      if (word.text === '-A' || word.text === '--all') return ADD_SWEEP;
    }
    return null;
  }
  if (operation === 'reset') return resetSweep(args);
  if (operation === 'checkout') return wholeTreePath(args) ? CHECKOUT_SWEEP : null;
  if (operation === 'restore') return wholeTreePath(args) ? RESTORE_SWEEP : null;
  if (operation === 'clean') return cleanSweep(args);
  if (operation !== 'commit') return null;
  const separator = args.findIndex((word) => word.literal && word.text === '--');
  if (separator !== -1 && args.slice(separator + 1).some((word) => word.text !== '')) return null;
  const only = args.findIndex((word) => word.literal && (word.text === '--only' || word.text === '-o'));
  if (only !== -1) {
    const pathspec = args[only + 1];
    if (pathspec !== undefined && pathspec.text !== '' && !(pathspec.literal && pathspec.text.startsWith('-'))) return null;
  }
  return args.some((word) => word.literal && word.text === '--amend') ? AMEND_SWEEP : COMMIT_SWEEP;
}

function sweepText(text: string): ShellSweepShape | null {
  for (const call of gitCalls(text, 0, []) ?? []) {
    const found = gitSweep(call.operation, call.args);
    if (found !== null) return call.within.length === 0 ? found : { ...found, within: call.within };
  }
  return null;
}

export function shellSweepShape(command: string): ShellSweepShape | null {
  return sweepText(command);
}

const IDLE = new Set(['echo', 'printf', 'true', ':', 'date']);

const sleeps = (command: ShellCommand): boolean => verbName(withoutPrefixes(command.words)[0]) === 'sleep';

const idles = (command: ShellCommand): boolean =>
  IDLE.has(verbName(withoutPrefixes(command.words)[0]) ?? '') &&
  command.words.every((word) => word.literal) &&
  command.redirects.every((redirect) => redirect.target === 'descriptor');

export function shellOnlySleeps(command: string): boolean {
  const commands = shellCommands(command);
  if (commands === null) return false;
  return commands.some(sleeps) && commands.every((each) => sleeps(each) || idles(each));
}

export type ShellFileEdit = { readonly program: 'sed' | 'perl'; readonly files: readonly string[] };

const SWEEP_FILES = 10;

function sedEdits(args: readonly ShellWord[]): readonly ShellWord[] | null {
  let inPlace = false;
  let scripted = false;
  const operands: ShellWord[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at] as ShellWord;
    const text = word.text;
    if (text === '--') {
      operands.push(...args.slice(at + 1));
      break;
    }
    if (text === '-e' || text === '-f' || text === '--expression' || text === '--file') {
      scripted = true;
      at += 1;
      continue;
    }
    if (text.startsWith('--expression=') || text.startsWith('--file=')) {
      scripted = true;
      continue;
    }
    if (text === '--in-place' || text.startsWith('--in-place=')) {
      inPlace = true;
      continue;
    }
    if (/^-[A-Za-z]/.test(text) && !text.startsWith('--')) {
      const cluster = /^-[nErsuz]*i/.test(text);
      if (cluster) {
        inPlace = true;
        if (text.endsWith('i') && args[at + 1]?.text === '') at += 1;
      }
      if (/^-[nErsuz]*[ef]$/.test(text)) {
        scripted = true;
        at += 1;
      }
      continue;
    }
    if (!scripted) {
      scripted = true;
      continue;
    }
    operands.push(word);
  }
  return inPlace ? operands : null;
}

function perlEdits(args: readonly ShellWord[]): readonly ShellWord[] | null {
  let inPlace = false;
  let scripted = false;
  const operands: ShellWord[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at] as ShellWord;
    const text = word.text;
    if (text === '--') {
      operands.push(...args.slice(at + 1));
      break;
    }
    if (/^-[A-Za-z]/.test(text)) {
      const flags = /^-([a-hj-zA-Z]*)/.exec(text)?.[1] ?? '';
      if (text.slice(1 + flags.length).startsWith('i')) inPlace = true;
      if (/[eE]$/.test(text) && !text.slice(1 + flags.length).startsWith('i')) {
        scripted = true;
        at += 1;
      }
      continue;
    }
    if (!scripted) {
      scripted = true;
      continue;
    }
    operands.push(word);
  }
  return inPlace ? operands : null;
}

export function shellFileEdit(command: string): ShellFileEdit | null {
  for (const one of shellCommands(command) ?? []) {
    const words = withoutPrefixes(one.words);
    const verb = verbName(words[0]);
    const program = verb === 'sed' || verb === 'gsed' ? 'sed' : verb === 'perl' ? 'perl' : null;
    if (program === null) continue;
    const operands = program === 'sed' ? sedEdits(words.slice(1)) : perlEdits(words.slice(1));
    if (operands === null || operands.length === 0 || operands.length >= SWEEP_FILES) continue;
    if (!operands.every((word) => word.literal)) continue;
    return { program, files: operands.map((word) => word.text) };
  }
  return null;
}

const READERS = new Set([
  'basename',
  'cat',
  'cd',
  'cmp',
  'column',
  'comm',
  'cut',
  'date',
  'df',
  'diff',
  'dirname',
  'du',
  'echo',
  'egrep',
  'expr',
  'false',
  'fgrep',
  'grep',
  'head',
  'hexdump',
  'hostname',
  'id',
  'jq',
  'ls',
  'md5',
  'md5sum',
  'nl',
  'od',
  'printenv',
  'printf',
  'pwd',
  'readlink',
  'realpath',
  'seq',
  'sha1sum',
  'sha256sum',
  'shasum',
  'sleep',
  'stat',
  'tail',
  'test',
  'tr',
  'true',
  'type',
  'uname',
  'wc',
  'which',
  'whoami',
  ':',
  '[',
]);

const GIT_READS = new Set([
  'blame',
  'cat-file',
  'describe',
  'diff',
  'for-each-ref',
  'grep',
  'log',
  'ls-files',
  'ls-tree',
  'merge-base',
  'name-rev',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'status',
]);

const SED_PRINT = /^(?:\d+|\$)(?:,(?:\d+|\$))?p$/;

const RUNS = /\$\(|`|<\(|>\(/;

function sedReads(args: readonly ShellWord[]): boolean {
  const script = args.find((word) => !word.text.startsWith('-'));
  return (
    script !== undefined &&
    script.literal &&
    SED_PRINT.test(script.text) &&
    args.every((word) => !word.text.startsWith('-') || word.text === '-n' || word.text === '-E' || word.text === '-r')
  );
}

function reads(words: readonly ShellWord[]): boolean {
  const verb = verbName(words[0]);
  const args = words.slice(1);
  if (verb === null) return false;
  if (READERS.has(verb)) return true;
  if (verb === 'sort')
    return !args.some((word) => /^-[A-Za-z]*[oT]/.test(word.text) || /^--(?:output|temporary-directory|compress-program)/.test(word.text));
  if (verb === 'rg') return !args.some((word) => /^--(?:pre|hostname-bin)(?:=|$)/.test(word.text));
  if (verb === 'find') return !findMutation(words).writes;
  if (verb === 'sed') return sedReads(args);
  if (verb !== 'git') return false;
  const found = gitOperation(words);
  if (found === null || !GIT_READS.has((words[found.at] as ShellWord).text)) return false;
  if (
    words
      .slice(1, found.at)
      .some((word) => word.text === '-c' || word.text.startsWith('--config-env') || word.text.startsWith('--exec-path'))
  )
    return false;
  return !words.slice(found.at + 1).some((word) => /^(?:--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(word.text));
}

export function shellPartReads(one: ShellCommand): boolean {
  return (
    one.redirects.every(
      (redirect) => redirect.target === 'descriptor' || (redirect.target.literal && redirect.target.text === '/dev/null'),
    ) && reads(withoutPrefixes(one.words))
  );
}

export function shellReadsOnly(command: string): boolean {
  if (RUNS.test(command)) return false;
  const commands = shellCommands(command);
  if (commands === null || commands.length === 0) return false;
  return commands.every(shellPartReads);
}

export function inPlaceOperands(words: readonly ShellWord[]): readonly ShellWord[] | null {
  const verb = verbName(words[0]);
  if (verb === 'sed' || verb === 'gsed') return sedEdits(words.slice(1));
  return verb === 'perl' ? perlEdits(words.slice(1)) : null;
}

export function shellCommitDirs(command: string): readonly (readonly string[])[] {
  return (gitCalls(command, 0, []) ?? []).flatMap((call) =>
    call.operation === 'commit' ||
    (call.operation === 'merge' && call.args.length === 1 && call.args[0]?.literal === true && call.args[0].text === '--continue')
      ? [call.within]
      : [],
  );
}
