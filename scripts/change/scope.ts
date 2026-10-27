import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Graph, testFile } from './graph.ts';
import { Loads } from './loads.ts';
import { workspacePaths } from './packages.ts';
import { Records } from './records.ts';
import { inSession, sessionPaths } from './session.ts';

export type Scope = {
  readonly args: readonly string[];
  readonly value: (name: string) => string | undefined;
  readonly root: string;
  readonly cache: string;
  readonly graph: Graph;
  readonly records: Records;
  readonly loads: Loads;
  readonly named: string | undefined;
  readonly changed: readonly string[];
  readonly global: string | undefined;
  readonly session: { readonly session: string } | undefined;
  readonly tests: readonly string[];
};

export const scopeOf = async (
  args: readonly string[],
  options: { readonly valued: readonly string[]; readonly switches: readonly string[]; readonly usage: string; readonly session: boolean },
): Promise<Scope> => {
  const valued = new Set(['--root', '--base', '--commit', '--paths-from', '--package', '--file', ...options.valued]);
  for (let at = 0; at < args.length; at++) {
    if (valued.has(args[at]!)) {
      if (args[at + 1] === undefined || args[at + 1]!.startsWith('--')) throw new Error(`${args[at]} needs a value`);
      at++;
    } else if (![...options.switches, '--help'].includes(args[at]!)) throw new Error(`Unknown option: ${args[at]}`);
  }
  if (args.includes('--help')) {
    console.log(options.usage);
    process.exit(0);
  }
  const value = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const root = resolve(value('--root') ?? process.cwd());
  const git = (...command: string[]): string => {
    const result = Bun.spawnSync(['git', '-C', root, ...command], { stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error(`git ${command.join(' ')}: ${result.stderr.toString().trim()}`);
    return result.stdout.toString();
  };
  const split = (text: string): string[] => text.split('\0').filter(Boolean);
  const tracked = workspacePaths(root);
  const declared = existsSync(join(root, 'tagma.config.ts'))
    ? ((await import(join(root, 'tagma.config.ts'))) as { readonly default: import('@runlith/tagma/rules').Config }).default
    : undefined;
  const inspection = declared?.inspections?.modules;
  const built =
    inspection !== undefined && 'builtin' in inspection && inspection.builtin === 'modules'
      ? ((inspection.params as import('@runlith/tagma/rules').ModulesParams).built ?? [])
      : [];
  const identity = createHash('sha256')
    .update(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim())
    .digest('hex')
    .slice(0, 16);
  const cache = join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'runlith', 'change-check', identity);
  mkdirSync(cache, { recursive: true });
  const records = new Records(cache);
  const loads = new Loads(cache);
  const graph = new Graph(root, tracked, new Map(built.map((entry) => [entry.output, entry.source])), records, loads);
  const commit = value('--commit');
  const askedBase = value('--base');
  const listed = value('--paths-from');
  if ([commit, askedBase, listed].filter((one) => one !== undefined).length > 1)
    throw new Error('Choose one of --base, --commit or --paths-from');
  const asked = commit !== undefined || askedBase !== undefined || listed !== undefined;
  const session = !asked && options.session && inSession() ? sessionPaths(root) : undefined;
  let base = askedBase;
  if (!asked && options.session && session === undefined) {
    const branch = git('branch', '--show-current').trim();
    const main = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/main', 'refs/heads/master')
      .trim()
      .split('\n')
      .filter(Boolean)[0];
    base = main !== undefined && branch !== '' && branch !== main ? git('merge-base', 'HEAD', main).trim() : 'HEAD';
  }
  const changed = [
    ...new Set(
      commit !== undefined
        ? split(git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', commit))
        : listed !== undefined
          ? readFileSync(resolve(listed), 'utf8').split(/\r?\n/).filter(Boolean)
          : session !== undefined
            ? [...session.paths]
            : base !== undefined
              ? [...split(git('diff', '--name-only', '-z', base)), ...split(git('ls-files', '-z', '--others', '--exclude-standard'))]
              : [],
    ),
  ].filter((path) => !path.startsWith('archive/'));
  const named =
    commit ?? base ?? (listed !== undefined ? 'named paths' : session === undefined ? undefined : `lines session ${session.session} holds`);
  const global = changed.find(
    (path) =>
      /^(?:bun\.lock|bunfig\.toml|Cargo\.lock|tagma\.config\.ts)$/.test(path) ||
      path.startsWith('packages/testbed/') ||
      path.startsWith('patches/') ||
      path.includes('/drizzle/'),
  );
  const pkg = value('--package')?.replace(/\/$/, '');
  if (pkg !== undefined && !graph.packages.some((one) => one.dir === pkg)) throw new Error(`No workspace package: ${value('--package')}`);
  const tests = [...graph.files]
    .filter(testFile)
    .filter((file) => pkg === undefined || graph.package(file).dir === pkg)
    .filter((file) => value('--file') === undefined || file === value('--file'));
  if (value('--file') !== undefined && !tests.includes(value('--file')!)) throw new Error(`No test file in scope: ${value('--file')}`);
  return { args, value, root, cache, graph, records, loads, named, changed, global, session, tests };
};
