import { readFileSync } from 'node:fs';
import { Schema } from 'effect';
import { type Assembled, assembled, BUILTIN_IDS, BUILTINS, describe, type Inspection, mapProblem, takesMap } from '../builtins';
import { moduleMapSchema } from '../core/rule';
import { ready } from '../builtins.node';
import { type Debt, siteRows } from '../core/verdict';
import { commitOf, gitRoot, measure, repositoryPath } from '../core/node/run';
import type { Violation } from '../core/verdict';

const flag = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const listedAfter = (args: readonly string[], name: string): readonly string[] | undefined => {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const end = args.findIndex((arg, index) => index > at && arg.startsWith('--'));
  return args.slice(at + 1, end === -1 ? args.length : end);
};

const signalOf = (one: Violation): string => one.fingerprint.slice(0, Math.max(0, one.fingerprint.indexOf(' '))) || one.fingerprint;

const said = (one: Violation): string =>
  `${one.file}:${one.line} ${one.specifier === undefined ? (one.message ?? '') : `imports ${one.specifier}${one.chain === undefined ? '' : ` → ${one.chain.join(' → ')}`}`} (${one.fingerprint})`;

const USAGE = `usage: bun src/cli/inspect.ts <inspection.json> [--repo <dir>] [--at <commit> | --worktree] [--base <commit>] [--paths <file…> | --paths-from <file>] [--debt <file>] [--all] [--json]
  Without --base: measures the inspection's whole reach at --at (HEAD by default) or in the working tree.
  With --base: judges the change from --base to --at (or to the working tree) as a gate would, less --debt's entries.
  With --paths or --paths-from (one path per line, from the repository root): the change is exactly those paths as the working tree holds them, a missing one deleted, over --at; --base defaults to --at.`;

const inspectionSchema = Schema.Union(BUILTIN_IDS.map((id) => Schema.Struct({ builtin: Schema.Literal(id), params: BUILTINS[id].params })));

const mapped = Schema.Struct({ params: Schema.Struct({ map: moduleMapSchema }) });

const assembledOf = (input: unknown): Assembled => {
  const inspection = Schema.decodeUnknownSync(inspectionSchema)(input) as Inspection;
  if (!takesMap(inspection)) return inspection as Assembled;
  const { map } = Schema.decodeUnknownSync(mapped)(input).params;
  const problem = mapProblem(inspection, map);
  if (problem !== undefined) throw new Error(`the module map: ${problem}`);
  return assembled(inspection, map);
};

const namedPaths = (args: readonly string[], repository: string): readonly string[] | undefined => {
  const listed = listedAfter(args, '--paths');
  const from = flag(args, '--paths-from');
  if (listed === undefined && from === undefined) return undefined;
  const lines = from === undefined ? [] : readFileSync(from, 'utf8').split('\n');
  return [
    ...new Set(
      [...(listed ?? []), ...lines]
        .map((one) => one.trim())
        .filter((one) => one !== '')
        .map((one) => repositoryPath(repository, one)),
    ),
  ].sort();
};

const main = async (args: readonly string[]): Promise<number> => {
  const pathArgs = new Set(listedAfter(args, '--paths') ?? []);
  const file = args.find(
    (arg, at) =>
      !arg.startsWith('--') && !pathArgs.has(arg) && !['--repo', '--at', '--base', '--debt', '--paths-from'].includes(args[at - 1] ?? ''),
  );
  if (file === undefined) {
    console.error(USAGE);
    return 2;
  }
  const inspection = assembledOf(JSON.parse(readFileSync(file, 'utf8')));
  await ready(inspection.builtin);
  const repository = flag(args, '--repo') ?? gitRoot(process.cwd());
  const named = namedPaths(args, repository);
  if (named !== undefined && args.includes('--worktree')) {
    console.error('--paths reads the named paths from the working tree and everything else from --at; it does not take --worktree');
    return 2;
  }
  const at = args.includes('--worktree') ? null : commitOf(repository, flag(args, '--at') ?? 'HEAD');
  const asked = flag(args, '--base');
  const base = asked === undefined ? (named === undefined ? undefined : (at as string)) : commitOf(repository, asked);
  const debtFile = flag(args, '--debt');
  const debt: readonly Debt[] =
    debtFile === undefined
      ? []
      : (JSON.parse(readFileSync(debtFile, 'utf8')) as readonly (string | Debt)[]).map((one) =>
          typeof one === 'string' ? { fingerprint: one } : one,
        );
  const started = performance.now();
  let measured: ReturnType<typeof measure>;
  try {
    measured = measure(repository, inspection, {
      at,
      base,
      named,
      debt,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 3;
  }
  const { judged } = measured;
  const verdict = { ...measured.verdict, violations: siteRows(measured.verdict.violations) };
  const ms = performance.now() - started;
  if (args.includes('--json')) {
    console.log(
      JSON.stringify({ over: base === undefined ? 'reach' : 'change', paths: judged.length, ms: Math.round(ms), ...verdict }, null, 2),
    );
    return verdict.violations.length === 0 ? 0 : 1;
  }
  console.log(describe(inspection));
  console.log('');
  const counts = new Map<string, number>();
  for (const one of verdict.violations) counts.set(signalOf(one), (counts.get(signalOf(one)) ?? 0) + 1);
  const over =
    base === undefined
      ? `the whole reach at ${at ?? 'the working tree'}`
      : `the change ${base.slice(0, 10)}..${at?.slice(0, 10) ?? 'working tree'}${named === undefined ? '' : ' with the named paths as the working tree holds them'}`;
  console.log(
    `${inspection.builtin} over ${over}: ${judged.length} paths judged, ${verdict.violations.length} ${base === undefined ? '' : 'new '}violations, ${verdict.unjudged.length} unjudged, ${Math.round(ms)} ms`,
  );
  for (const [signal, total] of [...counts].sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true })))
    console.log(`  ${signal}: ${total}`);
  const shown = args.includes('--all') ? verdict.violations : verdict.violations.slice(0, 40);
  if (shown.length > 0) console.log('');
  for (const one of shown) console.log(said(one));
  if (shown.length < verdict.violations.length) console.log(`… ${verdict.violations.length - shown.length} more; --all prints every one`);
  for (const one of verdict.followed ?? []) console.log(`followed ${one.from} → ${one.to}`);
  for (const one of verdict.unjudged) console.log(`unjudged ${one.file}:${one.line} ${one.specifier}`);
  return verdict.violations.length === 0 ? 0 : 1;
};

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
