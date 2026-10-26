import { Console, Data, Effect, FileSystem, Schema, Stream } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as effectNames from './effectNames.js';
import { sources } from './sources.js';
import { closureOf, plan, type PlanFailure } from './projectGraph.js';
import { findRoot, read, type RootMissing, type WorkspacePackage, type WorkspaceUnreadable } from './workspace.js';

export class ChecksFailed extends Data.TaggedError('ChecksFailed')<{
  readonly units: readonly string[];
}> {
  override get message(): string {
    return `Type errors reported by ${this.units.join(', ')}.`;
  }
}

export class ToolMissing extends Data.TaggedError('ToolMissing')<{
  readonly tool: string;
  readonly owner: string;
  readonly path: string;
}> {
  override get message(): string {
    return `${this.owner} needs ${this.tool}, which is not installed at ${this.path}.`;
  }
}

export class OutputUnreadable extends Data.TaggedError('OutputUnreadable')<{
  readonly owner: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `svelte-check ${this.owner}: ${this.reason}`;
  }
}

export class ScopeUnknown extends Data.TaggedError('ScopeUnknown')<{
  readonly target: string;
}> {
  override get message(): string {
    return `${this.target} is neither a workspace package nor a directory holding any.`;
  }
}

export class PreparationFailed extends Data.TaggedError('PreparationFailed')<{
  readonly owner: string;
  readonly missing: string;
  readonly status: number;
}> {
  override get message(): string {
    return `${this.owner} could not generate ${this.missing}: svelte-kit sync exited ${this.status}.`;
  }
}

export type CheckFailure =
  | ChecksFailed
  | ToolMissing
  | OutputUnreadable
  | ScopeUnknown
  | PreparationFailed
  | PlanFailure
  | RootMissing
  | WorkspaceUnreadable
  | PlatformError;

type Host = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;

type Scope =
  | { readonly kind: 'package'; readonly pkg: WorkspacePackage }
  | { readonly kind: 'group'; readonly roots: readonly WorkspacePackage[] };

export const run = Effect.fn('typecheck.run')(function* (target: string): Effect.fn.Return<void, CheckFailure, Host> {
  const root = yield* findRoot(target);
  const scanned = yield* read(root);
  const scope = yield* select(scanned, resolve(target));
  const roots = scope.kind === 'package' ? [scope.pkg] : scope.roots;
  const names = roots.map((entry) => entry.name);

  const packages = (yield* preparations(closureOf(scanned, names))) ? yield* read(root) : scanned;
  const graph = yield* plan(packages, names);

  const selected = scope.kind === 'package' ? (packages.find((p) => p.dir === scope.pkg.dir) ?? scope.pkg) : null;
  const failed: string[] = [];
  if (selected !== null && selected.kind === 'svelte') {
    yield* svelteCheck(root, selected, failed);
  } else if (graph.tsc.length === 0 && graph.svelte.length === 0) {
    yield* Console.log(`nothing to check: no workspace under ${relative(root, resolve(target)) || '.'} declares a typecheck`);
  } else {
    for (const pkg of graph.tsc) yield* check(root, pkg, failed);
    if (selected === null) for (const pkg of graph.svelte) yield* svelteCheck(root, pkg, failed);
  }
  const renames: effectNames.Finding[] = [];
  yield* sources(
    roots.map((entry) => entry.dir),
    (path, text) => {
      if (!effectNames.skipped(path)) renames.push(...effectNames.detect(path, text));
    },
  );

  for (const finding of renames) {
    yield* Console.log(`${relative(root, finding.path)}:${finding.line}: ${finding.v3} is not in effect 4 — ${finding.v4}`);
  }
  if (renames.length > 0) failed.push('effect v3 names');

  if (failed.length > 0) return yield* new ChecksFailed({ units: failed });
});

const preparations = Effect.fn('typecheck.preparations')(function* (
  reached: readonly WorkspacePackage[],
): Effect.fn.Return<boolean, PreparationFailed | PlatformError, Host> {
  const fileSystem = yield* FileSystem.FileSystem;
  let prepared = false;
  for (const pkg of reached) {
    if (pkg.kind === null || pkg.pendingExtends === null) continue;
    const kit = join(pkg.dir, 'node_modules', '.bin', 'svelte-kit');
    if (!(yield* fileSystem.exists(kit))) continue;
    yield* Console.log(`svelte-kit sync ${pkg.name} (${relative(pkg.dir, pkg.pendingExtends)} is not written yet)`);
    const status = yield* spawn('bun', ['--bun', kit, 'sync'], pkg.dir);
    if (status !== 0) return yield* new PreparationFailed({ owner: pkg.name, missing: pkg.pendingExtends, status });
    prepared = true;
  }
  return prepared;
});

function select(packages: readonly WorkspacePackage[], target: string): Effect.Effect<Scope, ScopeUnknown> {
  const exact = packages.find((entry) => entry.dir === target);
  if (exact !== undefined) return Effect.succeed({ kind: 'package', pkg: exact });
  const roots = packages.filter((entry) => entry.dir.startsWith(`${target}${sep}`));
  return roots.length > 0 ? Effect.succeed({ kind: 'group', roots }) : Effect.fail(new ScopeUnknown({ target }));
}

const check = Effect.fn('typecheck.check')(function* (
  root: string,
  pkg: WorkspacePackage,
  failed: string[],
): Effect.fn.Return<void, PlatformError, ChildProcessSpawner.ChildProcessSpawner> {
  const unit = `tsrs ${relative(root, pkg.dir)}`;
  yield* Console.log(unit);
  if ((yield* spawn('node', [TSRS, '-p', pkg.dir, '--noEmit', '--checkers', CHECKERS], root)) !== 0) failed.push(unit);
});

const TSRS = join(dirname(fileURLToPath(import.meta.resolve('tsrs/package.json'))), 'bin', 'tsrs');

const CHECKERS = '4';

const Diagnostic = Schema.Struct({
  type: Schema.Literals(['ERROR', 'WARNING']),
  filename: Schema.String,
  start: Schema.Struct({ line: Schema.Number, character: Schema.Number }),
  message: Schema.String,
  code: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  source: Schema.optional(Schema.String),
});

const decodeDiagnostic = Schema.decodeUnknownEffect(Schema.fromJsonString(Diagnostic));

const svelteCheck = Effect.fn('typecheck.svelteCheck')(function* (
  root: string,
  pkg: WorkspacePackage,
  failed: string[],
): Effect.fn.Return<void, ToolMissing | OutputUnreadable | PlatformError, Host> {
  if (pkg.config.kind === 'ok' && pkg.config.config.extendsKit) {
    const kit = yield* binary(pkg.dir, 'svelte-kit', pkg.name);
    if ((yield* spawn('bun', ['--bun', kit, 'sync'], pkg.dir)) !== 0) {
      failed.push(`svelte-kit sync ${pkg.name}`);
      return;
    }
  }
  const check = yield* binary(pkg.dir, 'svelte-check', pkg.name);
  const args = [
    '--import',
    import.meta.resolve('tsx'),
    check,
    '--tsconfig',
    './tsconfig.json',
    '--output',
    'machine-verbose',
    '--tsgo-experimental-api',
  ];
  let errors = 0;
  let warnings = 0;
  let complete = false;
  const status = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make('node', args, {
        cwd: pkg.dir,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'inherit',
      });
      yield* handle.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) =>
          Effect.gen(function* () {
            if (line.trim() === '') return;
            const record = /^\d+ (.*)$/.exec(line)?.[1];
            if (record === undefined) {
              return yield* new OutputUnreadable({ owner: pkg.name, reason: line });
            }
            if (record.startsWith('START ')) return;
            if (record.startsWith('COMPLETED ')) {
              complete = true;
              return;
            }
            if (record.startsWith('FAILURE ')) {
              return yield* new OutputUnreadable({ owner: pkg.name, reason: record });
            }
            const diagnostic = yield* decodeDiagnostic(record).pipe(
              Effect.mapError((error) => new OutputUnreadable({ owner: pkg.name, reason: error.message })),
            );
            const severity = diagnostic.type === 'ERROR' ? 'error' : 'warning';
            if (severity === 'error') errors++;
            else warnings++;
            const path = relative(root, resolve(pkg.dir, diagnostic.filename));
            const code = typeof diagnostic.code === 'number' ? `TS${diagnostic.code}` : (diagnostic.code ?? diagnostic.source ?? 'svelte');
            const message = diagnostic.message.replace(/\s+/g, ' ').trim();
            yield* Console.log(`${path}(${diagnostic.start.line + 1},${diagnostic.start.character + 1}): ${severity} ${code}: ${message}`);
          }),
        ),
      );
      return yield* handle.exitCode;
    }),
  );
  if (errors > 0 || warnings > 0) yield* Console.log(`svelte-check ${pkg.name}: ${errors} errors, ${warnings} warnings`);
  if (status !== 0 || errors > 0) failed.push(`svelte-check ${pkg.name}`);
  else if (!complete) return yield* new OutputUnreadable({ owner: pkg.name, reason: 'process ended without a COMPLETED record' });
});

const binary = Effect.fn('typecheck.binary')(function* (
  dir: string,
  tool: string,
  owner: string,
): Effect.fn.Return<string, ToolMissing | PlatformError, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = join(dir, 'node_modules', '.bin', tool);
  if (!(yield* fileSystem.exists(path))) return yield* new ToolMissing({ tool, owner, path });
  return path;
});

const spawn = Effect.fn('typecheck.spawn')(function* (
  command: string,
  args: readonly string[],
  cwd: string,
): Effect.fn.Return<number, PlatformError, ChildProcessSpawner.ChildProcessSpawner> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, args, {
        cwd,
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      return yield* handle.exitCode;
    }),
  );
});
