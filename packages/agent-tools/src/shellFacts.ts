import { basename, resolve } from 'node:path';
import { shellCommands, type ShellCommand, type ShellWord } from './shellCommands';
import { type Listing, listingOf, outputFlagsOf, plainProgram } from './shellReaders';
import { gitOperation, inPlaceOperands, shellPartReads } from './shellShapes';
import type { CommandFacts, CommandPart } from './WorkspaceChanges';

const UNKNOWN: CommandPart = { readsOnly: false, named: null, signature: null, listed: false, implicit: [] };
const QUIET: CommandPart = { readsOnly: true, named: [], signature: null, listed: false, implicit: [] };

const SUBSTITUTION = /\$\(|`/;
const RUNS = /\$\(|`|<\(|>\(/;
const GLOB = /[*?[\]{}]/;
const PATHLIKE = /\/|^\.{1,2}$|\.[A-Za-z0-9]+$/;
const SCRIPT = /\.(?:[cm]?[jt]sx?|py|rb|pl|sh|php)$/;
const WORD = /^[A-Za-z][A-Za-z0-9:_-]*$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PREFIXES = new Set(['command', 'builtin', 'exec', 'nohup', 'time']);
const INTERPRETERS = new Set([
  'node',
  'deno',
  'python',
  'python3',
  'py',
  'ruby',
  'perl',
  'php',
  'sh',
  'bash',
  'zsh',
  'dash',
  'tsx',
  'ts-node',
]);
const PYTHONS = new Set(['python', 'python3', 'py']);
const CODE_FLAGS = new Set(['-e', '-c', '-p', '--eval', '--print', '-', '-r']);
const ALIASES: Readonly<Record<string, string>> = { gradlew: 'gradle', mvnw: 'mvn', 'py.test': 'pytest' };
const WRAPPERS: Readonly<Record<string, readonly string[] | null>> = {
  bunx: null,
  npx: null,
  pnpx: null,
  uvx: null,
  pipx: ['run'],
  uv: ['run'],
  poetry: ['run'],
  pipenv: ['run'],
  pdm: ['run'],
  hatch: ['run'],
  rye: ['run'],
  bundle: ['exec'],
  pnpm: ['exec', 'dlx'],
  yarn: ['exec', 'dlx'],
  npm: ['exec'],
};
const PACKAGERS = new Set(['npm', 'pnpm', 'yarn']);
const BUN_SUBCOMMANDS = new Set([
  'test',
  'run',
  'check',
  'install',
  'i',
  'add',
  'remove',
  'x',
  'build',
  'pm',
  'upgrade',
  'link',
  'init',
  'create',
  'exec',
]);
const BROWSERS = /^(?:google chrome|chromium|chrome|chromium-browser|google-chrome|msedge|brave browser)$/i;
const OPERANDS_WRITE = new Set(['rm', 'rmdir', 'mkdir', 'touch', 'truncate']);
const TARGET_WRITE = new Set(['cp', 'mv', 'ln', 'install', 'rsync', 'ditto']);
const MUTATORS = new Set(['chmod', 'chown', 'tar', 'unzip', 'patch', 'dd']);
const GIT_WRITES = new Set([
  'add',
  'am',
  'apply',
  'branch',
  'checkout',
  'cherry-pick',
  'clean',
  'clone',
  'commit',
  'fetch',
  'init',
  'merge',
  'mv',
  'pull',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'stash',
  'switch',
  'tag',
  'update-index',
  'worktree',
]);
const INSTALLS: Readonly<Record<string, ReadonlySet<string>>> = {
  bun: new Set(['install', 'i', 'add', 'remove', 'rm', 'update', 'upgrade', 'link', 'unlink', 'pm']),
  npm: new Set([
    'install',
    'i',
    'ci',
    'add',
    'uninstall',
    'remove',
    'rm',
    'update',
    'upgrade',
    'link',
    'unlink',
    'dedupe',
    'prune',
    'audit',
  ]),
  pnpm: new Set(['install', 'i', 'add', 'remove', 'rm', 'update', 'up', 'upgrade', 'link', 'unlink', 'prune', 'dedupe', 'import']),
  yarn: new Set(['install', 'add', 'remove', 'upgrade', 'up', 'link', 'unlink', 'dedupe']),
  pip: new Set(['install', 'uninstall', 'download', 'wheel']),
  pip3: new Set(['install', 'uninstall', 'download', 'wheel']),
  uv: new Set(['sync', 'add', 'remove', 'lock', 'pip', 'venv', 'init']),
  poetry: new Set(['install', 'add', 'remove', 'lock', 'update', 'init', 'new', 'build']),
  pipenv: new Set(['install', 'uninstall', 'lock', 'update', 'sync']),
  pdm: new Set(['install', 'add', 'remove', 'lock', 'update', 'sync']),
  bundle: new Set(['install', 'update', 'add', 'remove', 'lock']),
  gem: new Set(['install', 'uninstall', 'update', 'build']),
  composer: new Set(['install', 'update', 'require', 'remove', 'dump-autoload']),
  go: new Set(['get', 'mod', 'generate', 'build', 'install', 'work']),
  cargo: new Set(['build', 'run', 'fix', 'install', 'update', 'add', 'remove', 'new', 'init', 'doc', 'bench', 'generate-lockfile']),
  mix: new Set(['deps.get', 'deps.update', 'compile', 'phx.gen.html', 'ecto.gen.migration']),
  dotnet: new Set(['restore', 'add', 'remove', 'build', 'publish', 'new']),
  swift: new Set(['build', 'package', 'run']),
  gradle: new Set(['build', 'assemble', 'clean', 'publish', 'wrapper']),
  mvn: new Set(['install', 'package', 'clean', 'deploy', 'compile']),
};

type Editor = { readonly when: (texts: readonly string[], sub: string | null) => boolean; readonly from: number };

const has = (texts: readonly string[], ...flags: readonly string[]): boolean => texts.some((text) => flags.includes(text));

const EDITORS: Readonly<Record<string, Editor>> = {
  oxfmt: { when: (texts) => !has(texts, '--check', '--list-different'), from: 1 },
  prettier: { when: (texts) => has(texts, '--write', '-w'), from: 1 },
  biome: { when: (texts) => has(texts, '--write', '--fix', '--apply', '--apply-unsafe'), from: 2 },
  eslint: { when: (texts) => has(texts, '--fix'), from: 1 },
  oxlint: { when: (texts) => has(texts, '--fix', '--fix-suggestions'), from: 1 },
  stylelint: { when: (texts) => has(texts, '--fix'), from: 1 },
  standard: { when: (texts) => has(texts, '--fix'), from: 1 },
  xo: { when: (texts) => has(texts, '--fix'), from: 1 },
  markdownlint: { when: (texts) => has(texts, '--fix'), from: 1 },
  'markdownlint-cli2': { when: (texts) => has(texts, '--fix'), from: 1 },
  dprint: { when: (_, sub) => sub === 'fmt', from: 2 },
  deno: { when: (texts, sub) => sub === 'fmt' && !has(texts, '--check'), from: 2 },
  ruff: {
    when: (texts, sub) => (sub === 'check' && has(texts, '--fix')) || (sub === 'format' && !has(texts, '--check', '--diff')),
    from: 2,
  },
  black: { when: (texts) => !has(texts, '--check', '--diff'), from: 1 },
  isort: { when: (texts) => !has(texts, '--check', '--check-only', '-c', '--diff'), from: 1 },
  autopep8: { when: (texts) => has(texts, '-i', '--in-place'), from: 1 },
  gofmt: { when: (texts) => has(texts, '-w'), from: 1 },
  goimports: { when: (texts) => has(texts, '-w'), from: 1 },
  rustfmt: { when: (texts) => !has(texts, '--check'), from: 1 },
  cargo: { when: (texts, sub) => sub === 'fmt' && !has(texts, '--check'), from: 2 },
  'clang-format': { when: (texts) => has(texts, '-i'), from: 1 },
  'swift-format': { when: (texts, sub) => sub === 'format' && has(texts, '-i', '--in-place'), from: 2 },
  swiftlint: { when: (texts) => has(texts, '--fix', '--autocorrect'), from: 1 },
  rubocop: { when: (texts) => has(texts, '-a', '-A', '-x', '--autocorrect', '--autocorrect-all', '--auto-correct'), from: 1 },
  ktlint: { when: (texts) => has(texts, '-F', '--format'), from: 1 },
  'php-cs-fixer': { when: (texts, sub) => sub === 'fix' && !has(texts, '--dry-run'), from: 2 },
  terraform: { when: (texts, sub) => sub === 'fmt' && !has(texts, '-check'), from: 2 },
  mix: { when: (texts, sub) => sub === 'format' && !has(texts, '--check-formatted'), from: 2 },
  dotnet: { when: (texts, sub) => sub === 'format' && !has(texts, '--verify-no-changes'), from: 2 },
};

type Program = { readonly name: string; readonly words: readonly ShellWord[]; readonly env: readonly string[] };

const nameOf = (word: ShellWord | undefined): string | null => (word === undefined || !word.literal ? null : basename(word.text));

const optionValued = (name: string, word: string): boolean =>
  (name === 'timeout' && /^-[sk]$/.test(word)) || (name === 'nice' && word === '-n') || (name === 'env' && /^-[uC]$/.test(word));

const firstOperand = (words: readonly ShellWord[]): number => words.findIndex((word, index) => index > 0 && !word.text.startsWith('-'));

function program(one: ShellCommand): Program | null {
  let words = one.words;
  const env = one.assignments.map((word) => word.text);
  for (;;) {
    const named = nameOf(words[0]);
    if (named === null) return words.length === 0 ? { name: '', words, env } : null;
    const name = ALIASES[named] ?? named;
    if (PREFIXES.has(name)) {
      words = words.slice(1);
      continue;
    }
    if (name === 'env' || name === 'nice' || name === 'timeout' || name === 'gtimeout') {
      let at = 1;
      while (at < words.length) {
        const text = (words[at] as ShellWord).text;
        if (name === 'env' && (text === '-C' || text.startsWith('--chdir'))) return null;
        if (name === 'env' && ASSIGNMENT.test(text)) env.push(text);
        else if (!text.startsWith('-')) break;
        at += optionValued(name, text) ? 2 : 1;
      }
      words = words.slice(name === 'timeout' || name === 'gtimeout' ? at + 1 : at);
      continue;
    }
    const wrapped = WRAPPERS[name];
    if (wrapped !== undefined) {
      const at = firstOperand(words);
      const sub = at === -1 ? null : (words[at] as ShellWord).text;
      if (wrapped === null && at !== -1) {
        words = words.slice(at);
        continue;
      }
      if (wrapped !== null && sub !== null && wrapped.includes(sub)) {
        const inner = firstOperand(words.slice(at));
        if (inner !== -1) {
          words = words.slice(at + inner);
          continue;
        }
      }
    }
    if (PYTHONS.has(name)) {
      const module = words.findIndex((word) => word.text === '-m');
      if (module !== -1 && words[module + 1]?.literal === true && words.slice(1, module).every((word) => word.text.startsWith('-'))) {
        words = words.slice(module + 1);
        continue;
      }
    }
    if (INTERPRETERS.has(name)) {
      const at = firstOperand(words);
      if (at !== -1 && (words[at] as ShellWord).text.includes('node_modules/.bin/')) {
        words = words.slice(at);
        continue;
      }
    }
    return { name, words, env };
  }
}

const subcommand = (words: readonly ShellWord[]): string | null => {
  for (const word of words) {
    if (!word.literal) return null;
    if (word.text.startsWith('-')) continue;
    return PATHLIKE.test(word.text) || !WORD.test(word.text) ? null : word.text;
  }
  return null;
};

function scriptOf(words: readonly ShellWord[], cwd: string | null): string | null {
  for (const word of words) {
    if (!word.literal) return null;
    if (CODE_FLAGS.has(word.text)) return null;
    if (word.text.startsWith('-')) continue;
    return cwd === null && !word.text.startsWith('/') ? null : resolve(cwd ?? '/', word.text);
  }
  return null;
}

function signatureOf(found: Program, cwd: string | null): string | null {
  const { name, words } = found;
  const args = words.slice(1);
  const lead = words[0] as ShellWord;
  if (lead.text.includes('/') && !lead.text.includes('node_modules/.bin/') && ALIASES[basename(lead.text)] === undefined)
    return cwd === null && !lead.text.startsWith('/') ? null : resolve(cwd ?? '/', lead.text);
  if (name === 'git') {
    const at = gitOperation(words);
    return at === null ? 'git' : `git ${(words[at.at] as ShellWord).text}`;
  }
  if (name === 'bun') {
    const sub = args.find((word) => !word.text.startsWith('-'));
    if (sub === undefined || !sub.literal) return null;
    if (args.slice(0, args.indexOf(sub)).some((word) => CODE_FLAGS.has(word.text))) return null;
    if (sub.text === 'run') {
      const script = subcommand(args.slice(args.indexOf(sub) + 1));
      if (script !== null) return `bun run ${script}`;
      const file = scriptOf(args.slice(args.indexOf(sub) + 1), cwd);
      return file === null ? null : `bun ${file}`;
    }
    if (BUN_SUBCOMMANDS.has(sub.text)) return `bun ${sub.text}`;
    if (SCRIPT.test(sub.text) || sub.text.includes('/')) {
      const file = scriptOf([sub], cwd);
      return file === null ? null : `bun ${file}`;
    }
    return `bun run ${sub.text}`;
  }
  if (PACKAGERS.has(name)) {
    const sub = subcommand(args);
    if (sub === 'run' || sub === 'run-script') {
      const script = subcommand(args.slice(args.findIndex((word) => word.text === sub) + 1));
      return script === null ? null : `${name} run ${script}`;
    }
    return sub === null ? name : `${name} ${sub}`;
  }
  if (INTERPRETERS.has(name) && !(name === 'node' && args.some((word) => word.text === '--test'))) {
    const file = scriptOf(args, cwd);
    return file === null ? null : `${name} ${file}`;
  }
  if (BROWSERS.test(name)) return name.toLowerCase();
  if (plainProgram(name)) return name;
  const sub = subcommand(args);
  return sub === null ? name : `${name} ${sub}`;
}

const operandsOf = (words: readonly ShellWord[], from: number): readonly ShellWord[] =>
  words.slice(from).filter((word) => !word.text.startsWith('-'));

const unresolvable =
  (cwd: string | null) =>
  (word: ShellWord): boolean =>
    !word.literal || word.text === '' || GLOB.test(word.text) || word.text.startsWith('~') || (cwd === null && !word.text.startsWith('/'));

function editedPaths(found: Program): { readonly operands: readonly ShellWord[]; readonly sides: readonly string[] } | null {
  const { name, words } = found;
  const texts = words.map((word) => word.text);
  const inPlace = inPlaceOperands(words);
  if (inPlace !== null) {
    const cluster = name === 'perl' ? /^-[a-hj-zA-LN-Z]*i\S+$/ : /^-[nErsuz]*i\S+$/;
    const flag = texts.find((text) => (cluster.test(text) && !/^-[MmIx]/.test(text)) || text.startsWith('--in-place='));
    const suffix =
      flag === undefined ? '' : flag.startsWith('--in-place=') ? flag.slice('--in-place='.length) : flag.slice(flag.indexOf('i') + 1);
    return { operands: inPlace, sides: suffix === '' || suffix.includes('*') ? [] : [suffix] };
  }
  const editor = EDITORS[name];
  if (editor === undefined || !editor.when(texts, subcommand(words.slice(1)))) return null;
  const sides =
    name === 'eslint' && texts.includes('--cache')
      ? [`=${texts.find((text) => text.startsWith('--cache-location='))?.slice('--cache-location='.length) ?? '.eslintcache'}`]
      : [];
  return { operands: operandsOf(words, editor.from), sides };
}

type GitGrammar = { readonly flags: ReadonlySet<string>; readonly valued: ReadonlySet<string> };

const GIT_GLOBALS: GitGrammar = { flags: new Set(['--no-pager', '-P', '--no-optional-locks']), valued: new Set(['-C']) };

const GIT_PATHSPECS: Readonly<Record<string, GitGrammar>> = {
  rm: {
    flags: new Set(['-f', '--force', '-r', '-q', '--quiet', '--cached', '-n', '--dry-run', '--ignore-unmatch', '--sparse']),
    valued: new Set(),
  },
  mv: { flags: new Set(['-f', '--force', '-k', '-v', '--verbose', '-n', '--dry-run', '--sparse']), valued: new Set() },
  restore: {
    flags: new Set([
      '-p',
      '--patch',
      '-W',
      '--worktree',
      '-S',
      '--staged',
      '-q',
      '--quiet',
      '--progress',
      '--no-progress',
      '--ours',
      '--theirs',
      '-m',
      '--merge',
      '--ignore-unmerged',
      '--ignore-skip-worktree-bits',
      '--overlay',
      '--no-overlay',
    ]),
    valued: new Set(['-s', '--source', '--conflict']),
  },
  checkout: {
    flags: new Set([
      '-q',
      '--quiet',
      '-f',
      '--force',
      '--ours',
      '--theirs',
      '-m',
      '--merge',
      '-p',
      '--patch',
      '--overlay',
      '--no-overlay',
      '--ignore-skip-worktree-bits',
      '--progress',
      '--no-progress',
    ]),
    valued: new Set(['--conflict']),
  },
};

function gitOptions(
  words: readonly ShellWord[],
  grammar: GitGrammar,
): { readonly flags: ReadonlySet<string>; readonly operands: readonly ShellWord[] } | null {
  const flags = new Set<string>();
  const operands: ShellWord[] = [];
  for (let at = 0; at < words.length; at += 1) {
    const { text, literal } = words[at] as ShellWord;
    if (!literal) return null;
    if (!text.startsWith('-')) operands.push(words[at] as ShellWord);
    else if (grammar.valued.has(text)) at += 1;
    else if (grammar.valued.has(text.split('=')[0] ?? '') && text.startsWith('--')) continue;
    else if (grammar.flags.has(text)) flags.add(text);
    else if (/^-[A-Za-z]{2,}$/.test(text) && [...text.slice(1)].every((letter) => grammar.flags.has(`-${letter}`)))
      for (const letter of text.slice(1)) flags.add(`-${letter}`);
    else return null;
  }
  return { flags, operands };
}

function gitPathspecs(operation: string, args: readonly ShellWord[]): readonly ShellWord[] | null | undefined {
  const grammar = GIT_PATHSPECS[operation];
  if (grammar === undefined) return undefined;
  const dash = args.findIndex((word) => word.text === '--');
  const after = dash === -1 ? [] : args.slice(dash + 1);
  if (operation === 'checkout' && dash === -1) return null;
  const read = gitOptions(dash === -1 ? args : args.slice(0, dash), grammar);
  if (read === null) return null;
  const { flags, operands } = read;
  if (flags.has('-n') || flags.has('--dry-run')) return [];
  if (operation === 'rm' && flags.has('--cached')) return [];
  if (operation === 'restore' && (flags.has('-S') || flags.has('--staged')) && !flags.has('-W') && !flags.has('--worktree')) return [];
  if (operation === 'checkout') return operands.length > 1 ? null : after;
  return [...operands, ...after];
}

function mutatedPaths(found: Program, cwd: string | null): readonly string[] | null | undefined {
  const { name, words } = found;
  const sub = words.slice(1).find((word) => !word.text.startsWith('-'))?.text;
  if (name === 'git') {
    const at = gitOperation(words);
    const operation = at === null ? null : (words[at.at] as ShellWord).text;
    if (operation === 'add') return [];
    const placed =
      at !== null &&
      !found.env.some((one) => one.startsWith('GIT_')) &&
      gitOptions(words.slice(1, at.at), GIT_GLOBALS) !== null &&
      words.slice(1, at.at).filter((word) => word.text === '-C').length === at.within.length;
    const pathspecs = !placed || operation === null ? undefined : gitPathspecs(operation, words.slice(at.at + 1));
    if (pathspecs === null || at === null || pathspecs === undefined)
      return operation !== null && GIT_WRITES.has(operation) ? null : undefined;
    const base = cwd === null ? null : resolve(cwd, ...at.within);
    if (pathspecs.some((word) => unresolvable(base)(word) || word.text.startsWith(':'))) return null;
    return pathspecs.map((word) => resolve(base ?? '/', word.text));
  }
  if (sub !== undefined && INSTALLS[name]?.has(sub) === true) return null;
  if (MUTATORS.has(name)) return null;
  if (!OPERANDS_WRITE.has(name) && !TARGET_WRITE.has(name)) return undefined;
  if (words.some((word) => word.text === '-t' || word.text.startsWith('--target-directory'))) return null;
  const operands = operandsOf(words, 1);
  if (operands.length === 0 || operands.some(unresolvable(cwd))) return null;
  const chosen = OPERANDS_WRITE.has(name) || name === 'mv' ? operands : operands.slice(-1);
  return chosen.map((word) => resolve(cwd ?? '/', word.text));
}

function listedOf(found: Program): Listing {
  if (BROWSERS.test(found.name))
    return { listed: found.words.some((word) => word.text.startsWith('--headless')), flagged: false, implicit: [] };
  return listingOf(found.name, found.words, found.env);
}

function outputsOf(one: ShellCommand, found: Program, cwd: string | null): readonly string[] | null {
  const targets: ShellWord[] = [];
  for (const redirect of one.redirects) {
    if (redirect.target === 'descriptor') continue;
    if (redirect.target.literal && redirect.target.text === '/dev/null') continue;
    targets.push(redirect.target);
  }
  if (found.name === 'tee') targets.push(...operandsOf(found.words, 1));
  const flagged = flaggedOutputs(found);
  if (flagged === null) return null;
  targets.push(...flagged);
  const paths: string[] = [];
  for (const target of targets) {
    if (target.text.startsWith('/dev/')) continue;
    if (unresolvable(cwd)(target)) return null;
    paths.push(resolve(cwd ?? '/', target.text));
  }
  return paths;
}

const valued = (word: ShellWord, text: string): ShellWord => ({ text, literal: word.literal });

function flaggedOutputs(found: Program): readonly ShellWord[] | null {
  const { name, words } = found;
  const targets: ShellWord[] = [];
  if (name === 'curl') {
    for (const [at, word] of words.entries()) {
      if (!/^-[A-Za-z]+/.test(word.text)) continue;
      const cluster = word.text.slice(1);
      if (/[OJ]/.test(cluster.split('o')[0] ?? '')) return null;
      const o = cluster.indexOf('o');
      if (o === -1) continue;
      const rest = cluster.slice(o + 1);
      const target = rest === '' ? words[at + 1] : valued(word, rest);
      if (target === undefined) return null;
      targets.push(target);
    }
  }
  if (BROWSERS.test(name)) {
    for (const word of words) {
      if (word.text.startsWith('--user-data-dir=')) targets.push(valued(word, word.text.slice('--user-data-dir='.length)));
      if (word.text === '--screenshot') targets.push(valued(word, 'screenshot.png'));
      if (word.text === '--print-to-pdf') targets.push(valued(word, 'output.pdf'));
      if (word.text.startsWith('--screenshot=') || word.text.startsWith('--print-to-pdf='))
        targets.push(valued(word, word.text.slice(word.text.indexOf('=') + 1)));
    }
  }
  const flags = outputFlagsOf(name);
  for (const [at, word] of words.entries()) {
    const flag = flags.find((one) => word.text === one || word.text.startsWith(`${one}=`));
    if (flag === undefined || (name === 'curl' && flag === '-o')) continue;
    const value = word.text === flag ? words[at + 1] : valued(word, word.text.slice(flag.length + 1));
    if (value === undefined) return null;
    const text = flag === '--cov-report' ? (value.text.includes(':') ? value.text.slice(value.text.indexOf(':') + 1) : null) : value.text;
    if (text !== null) targets.push(valued(value, text));
  }
  return targets;
}

function partOf(one: ShellCommand, cwd: string | null): CommandPart {
  const texts = [
    ...one.words,
    ...one.assignments,
    ...one.redirects.flatMap((redirect) => (redirect.target === 'descriptor' ? [] : [redirect.target])),
  ];
  if (texts.some((word) => SUBSTITUTION.test(word.text))) return UNKNOWN;
  if (one.words.length === 0)
    return one.redirects.length === 0
      ? QUIET
      : { ...QUIET, readsOnly: false, named: outputsOf(one, { name: '', words: [], env: [] }, cwd) };
  const found = program(one);
  if (
    found === null ||
    found.name === '' ||
    found.name === 'eval' ||
    found.name === 'source' ||
    found.name === '.' ||
    found.name === 'xargs'
  )
    return UNKNOWN;
  const readsOnly = shellPartReads(one);
  const signature = signatureOf(found, cwd);
  const outputs = outputsOf(one, found, cwd);
  if (readsOnly) return { readsOnly, named: [], signature, listed: false, implicit: [] };
  const mutated = mutatedPaths(found, cwd);
  if (mutated !== undefined)
    return {
      readsOnly,
      named: mutated === null || outputs === null ? null : [...mutated, ...outputs],
      signature: null,
      listed: false,
      implicit: [],
    };
  const edits = editedPaths(found);
  if (edits !== null) {
    if (outputs === null || edits.operands.some(unresolvable(cwd)))
      return { readsOnly, named: null, signature: null, listed: false, implicit: [] };
    const base = cwd ?? '/';
    const operands = edits.operands.length === 0 ? [base] : edits.operands.map((word) => resolve(base, word.text));
    const sides = edits.sides.flatMap((side) =>
      side.startsWith('=') ? [resolve(base, side.slice(1))] : operands.map((operand) => `${operand}${side}`),
    );
    return { readsOnly, named: [...operands, ...sides, ...outputs], signature, listed: false, implicit: [] };
  }
  const { listed, flagged, implicit } = listedOf(found);
  if (found.name === 'tee') return { readsOnly, named: outputs, signature: null, listed, implicit };
  const reading = listed || (outputs !== null && outputs.length > 0 && shellPartReads({ ...one, redirects: [] }));
  const learnable = !flagged && outputs !== null && (listed || outputs.length === 0);
  return { readsOnly, named: reading ? outputs : null, signature: learnable ? signature : null, listed, implicit };
}

export function shellFacts(command: string, cwd: string): CommandFacts {
  const commands = shellCommands(command);
  if (commands === null || commands.length === 0) return { readsOnly: false, parts: [UNKNOWN] };
  const parts: CommandPart[] = [];
  let at: string | null = cwd;
  for (const [index, one] of commands.entries()) {
    const name = nameOf(one.words[0]);
    if (name === 'cd' || name === 'pushd' || name === 'popd') {
      const target = one.words[1];
      const piped = one.piped || commands[index + 1]?.piped === true;
      if (!piped)
        at =
          name === 'popd' || target === undefined || one.words.length > 2 || unresolvable(at)(target) || target.text.startsWith('-')
            ? null
            : resolve(at ?? '/', target.text);
      parts.push(QUIET);
      continue;
    }
    parts.push(partOf(one, at));
  }
  return { readsOnly: !RUNS.test(command) && commands.every(shellPartReads), parts };
}
