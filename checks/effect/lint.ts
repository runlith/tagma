import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

type Diagnostic = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: string;
  readonly name: string;
  readonly message: string;
};

type Outcome =
  | { readonly project: string; readonly diagnostics: readonly Diagnostic[] }
  | { readonly project: string; readonly failure: string };

const PARALLEL = 3;
const here = import.meta.dir;
const root = resolve(here, '..', '..');
const binary = join(here, 'node_modules', '.bin', 'effect-tsgo');

const VALUED = ['--rule', '--json'];
const FLAGS = ['--list'];

const refuse = (reason: string): never => {
  console.error(`effect:lint: ${reason}`);
  console.error('usage: bun run effect:lint [project-dir…] [--list] [--rule <name>] [--json <file>]');
  process.exit(2);
};

const args = Bun.argv.slice(2);
const options = new Map<string, string>();
const chosen: string[] = [];
for (let at = 0; at < args.length; at++) {
  const arg = args[at] as string;
  if (VALUED.includes(arg)) {
    const value = args[at + 1];
    if (value === undefined || value.startsWith('--')) refuse(`${arg} needs a value`);
    options.set(arg, value as string);
    at++;
  } else if (FLAGS.includes(arg)) options.set(arg, '');
  else if (arg.startsWith('--')) refuse(`unknown option ${arg}`);
  else chosen.push(arg);
}
const rule = options.get('--rule');
const jsonPath = options.get('--json');
const listing = options.has('--list') || rule !== undefined;

const lspconfig = JSON.stringify(JSON.parse(readFileSync(join(here, 'rules.json'), 'utf8')));

const usesEffect = (manifest: Record<string, Record<string, string> | undefined>): boolean =>
  ['dependencies', 'devDependencies', 'peerDependencies'].some((field) => manifest[field]?.effect !== undefined);

const workspaceProjects = (): string[] => {
  const globs: string[] = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces.packages;
  const found = new Set<string>();
  for (const pattern of globs) {
    for (const manifestPath of new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root, onlyFiles: true })) {
      const dir = dirname(manifestPath);
      if (resolve(root, dir) === here || !existsSync(join(root, dir, 'tsconfig.json'))) continue;
      if (usesEffect(JSON.parse(readFileSync(join(root, manifestPath), 'utf8')))) found.add(dir);
    }
  }
  return [...found].sort();
};

const projects = chosen.length > 0 ? chosen.map((dir) => relative(root, resolve(process.cwd(), dir))) : workspaceProjects();

const lint = async (project: string): Promise<Outcome> => {
  const child = Bun.spawn(
    [binary, 'diagnostics', '--project', join(root, project, 'tsconfig.json'), '--format', 'json', '--lspconfig', lspconfig],
    { cwd: here, stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const code = await child.exited;
  const tail = (stderr || stdout).trim().split('\n').slice(-3).join(' | ');
  const parsed = (() => {
    try {
      return JSON.parse(stdout) as { diagnostics?: Diagnostic[] };
    } catch {
      return null;
    }
  })();
  if (parsed?.diagnostics === undefined) return { project, failure: `exit ${code}: ${tail}` };
  const errors = parsed.diagnostics.some((one) => one.severity === 'error');
  if (child.signalCode !== null || code > 1 || (code === 1 && !errors))
    return { project, failure: `exit ${child.signalCode ?? code}: ${tail}` };
  return { project, diagnostics: parsed.diagnostics };
};

const outcomes: Outcome[] = [];
const queue = [...projects];
await Promise.all(
  Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let project = queue.shift(); project !== undefined; project = queue.shift()) {
      const outcome = await lint(project);
      outcomes.push(outcome);
      process.stderr.write(`${'failure' in outcome ? 'failed' : 'checked'} ${project}\n`);
    }
  }),
);

const seen = new Map<string, Diagnostic>();
for (const outcome of outcomes) {
  if ('failure' in outcome) continue;
  for (const one of outcome.diagnostics) {
    const at = { ...one, file: relative(root, one.file) };
    seen.set(`${at.file}:${at.line}:${at.column}:${at.name}`, at);
  }
}
const all = [...seen.values()];
const errors = all.filter((one) => one.severity === 'error').length;
const diagnostics = all
  .filter((one) => rule === undefined || one.name === rule)
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

if (jsonPath !== undefined) writeFileSync(resolve(process.cwd(), jsonPath), JSON.stringify(diagnostics, null, 2));

if (listing)
  for (const one of diagnostics) console.log(`${one.file}:${one.line}:${one.column}  ${one.severity}  ${one.name}  ${one.message}`);

const byRule = new Map<string, { severity: string; count: number; files: Set<string> }>();
for (const one of diagnostics) {
  const entry = byRule.get(one.name) ?? { severity: one.severity, count: 0, files: new Set<string>() };
  entry.count++;
  entry.files.add(one.file);
  byRule.set(one.name, entry);
}
console.log(`\n${'rule'.padEnd(36)}${'severity'.padEnd(10)}${'count'.padStart(7)}${'files'.padStart(7)}`);
for (const [name, entry] of [...byRule].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${name.padEnd(36)}${entry.severity.padEnd(10)}${String(entry.count).padStart(7)}${String(entry.files.size).padStart(7)}`);
}

const failures = outcomes.filter((outcome): outcome is Extract<Outcome, { failure: string }> => 'failure' in outcome);
console.log(
  `\n${outcomes.length - failures.length} of ${outcomes.length} projects checked · ${diagnostics.length} diagnostics shown · ${all.length} in all · ${errors} errors`,
);
for (const failure of failures) console.log(`failed: ${failure.project} — ${failure.failure}`);
process.exitCode = errors > 0 || failures.length > 0 ? 1 : 0;
