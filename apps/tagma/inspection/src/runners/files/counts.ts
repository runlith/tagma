import { Result } from 'effect';
import type { FilePlan, FileSide, ProgramAnswer, ProgramFinding, ProgramInvocation, ProgramKey } from '../../core/program.js';
export type Diagnostic = {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly message: string;
  readonly fix?: string;
};
export type CountTool = { readonly name: string; readonly version: string };

export const countAnswer = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  tool: CountTool,
  plan: FilePlan,
  diagnostics: readonly Diagnostic[],
): Result.Result<ProgramAnswer, string> => {
  const targets = new Set(plan.targets);
  const governed = new Set(input.keys.map((key) => key.id));
  const held = new Map<string, Map<string, ProgramFinding>>();
  for (const diagnostic of diagnostics) {
    if (!targets.has(diagnostic.path)) return Result.fail(`${tool.name} reported an unrequested file: ${diagnostic.path}`);
    if (!governed.has(diagnostic.id)) continue;
    const slash = diagnostic.path.indexOf('/');
    const side = diagnostic.path.slice(0, slash);
    const path = diagnostic.path.slice(slash + 1);
    const bucket = `${side}\0${diagnostic.id}`;
    const files = held.get(bucket) ?? new Map<string, ProgramFinding>();
    held.set(bucket, files);
    const previous = files.get(path);
    const shown = previous === undefined || diagnostic.line < (previous.line ?? diagnostic.line) ? diagnostic : previous;
    files.set(path, {
      fingerprint: path,
      path,
      line: shown.line,
      message: shown.message,
      fix: shown.fix,
      value: (previous?.value ?? 0) + 1,
    });
  }
  return Result.succeed({
    request: input.request,
    checker: input.checker,
    tree: input.tree,
    base: input.base,
    run: { tool: tool.name, version: tool.version, capabilities: { unit: 'count' } },
    readings: input.keys.flatMap((key) =>
      sides.map((side) => ({
        key: key.key,
        side: side.side,
        covered: side.whole ? { scope: 'reach' as const } : side.files.map((file) => file.path),
        findings: [...(held.get(`${side.side}\0${key.id}`)?.values() ?? [])],
        unjudged: [],
      })),
    ),
  });
};

export const fileInputs = (sides: readonly FileSide[], supports: (path: string) => boolean): Result.Result<FilePlan['files'], string> => {
  const files: { path: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const side of sides)
    for (const file of side.files) {
      if (!supports(file.path)) return Result.fail(`${file.path} is unsupported by this files adapter`);
      const path = `${side.side}/${file.path}`;
      if (seen.has(path)) return Result.fail(`the input repeats ${path}`);
      seen.add(path);
      files.push({ path, text: file.text });
    }
  return Result.succeed(files);
};

export const noParameters = (input: ProgramInvocation, why: string): Result.Result<void, string> => {
  const key = input.keys.find((one) => Object.keys(one.params).length !== 0);
  return key === undefined ? Result.succeed(undefined) : Result.fail(`${key.id} is bound with params, but ${why}`);
};

const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : typeof value === 'object' && value !== null
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
          .join(',')}}`
      : JSON.stringify(value);

export type RuleOptions = ReadonlyMap<string, ProgramKey['params']>;

export const ruleOptions = (input: ProgramInvocation): Result.Result<RuleOptions, string> => {
  const options = new Map<string, ProgramKey['params']>();
  for (const key of input.keys) {
    const held = options.get(key.id);
    if (held !== undefined && canonical(held) !== canonical(key.params))
      return Result.fail(`${key.id} is bound twice with different params in one run, and a linter holds one option set per rule`);
    options.set(key.id, key.params);
  }
  return Result.succeed(options);
};

export const ruleSetting = (params: ProgramKey['params']): 'error' | readonly ['error', ProgramKey['params']] =>
  Object.keys(params).length === 0 ? 'error' : ['error', params];
