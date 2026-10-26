import { dirname } from 'node:path';
import { Result } from 'effect';
import { type RuleOptions, ruleSetting } from '../files/counts.js';

export const LAW_CONFIG = 'tagma-oxlint.json';
const NATIVE: ReadonlyMap<string, string> = new Map([
  ['eslint', 'eslint'],
  ['react', 'react'],
  ['unicorn', 'unicorn'],
  ['typescript', 'typescript'],
  ['oxc', 'oxc'],
  ['jsdoc', 'jsdoc'],
  ['jest', 'jest'],
  ['vitest', 'vitest'],
  ['jsx-a11y', 'jsx-a11y'],
  ['next', 'nextjs'],
  ['react-perf', 'react-perf'],
  ['promise', 'promise'],
  ['node', 'node'],
  ['vue', 'vue'],
]);
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['react-hooks', 'react'],
  ['react_hooks', 'react'],
  ['typescript-eslint', 'typescript'],
  ['typescript_eslint', 'typescript'],
  ['@typescript-eslint', 'typescript'],
  ['deepscan', 'oxc'],
  ['jsx_a11y', 'jsx-a11y'],
  ['jsx-a11y-x', 'jsx-a11y'],
  ['jsx_a11y-x', 'jsx-a11y'],
  ['react_perf', 'react-perf'],
  ['nextjs', 'next'],
  ['@next', 'next'],
  ['@next/next', 'next'],
  ['import-x', 'import'],
]);
const TYPESCRIPT_AS_ESLINT: ReadonlySet<string> = new Set([
  'class-methods-use-this',
  'default-param-last',
  'init-declarations',
  'max-params',
  'no-array-constructor',
  'no-dupe-class-members',
  'no-empty-function',
  'no-invalid-this',
  'no-loop-func',
  'no-loss-of-precision',
  'no-magic-numbers',
  'no-redeclare',
  'no-restricted-imports',
  'no-shadow',
  'no-unused-expressions',
  'no-unused-vars',
  'no-use-before-define',
  'no-useless-constructor',
]);
const PACKAGE_PREFIX = /^(?:(@[^/]+)\/)?(?:eslint|oxlint)-plugin(?:-(.+))?$/;
const ENVIRONMENT = ['settings', 'env', 'globals'] as const;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const resolved = (specifier: string, from: string): Result.Result<string, string> => {
  try {
    return Result.succeed(Bun.resolveSync(specifier, from));
  } catch (error) {
    return Result.fail(`the JS plugin ${specifier} does not resolve from ${from}: ${String(error)}`);
  }
};

const environmentOf = (project: {
  readonly path: string;
  readonly absolute: string;
  readonly text: string;
}): Result.Result<Record<string, unknown>, string> => {
  if (!project.path.endsWith('.json')) return Result.fail(`${project.path} is not a JSON config`);
  let config: unknown;
  try {
    config = JSON.parse(project.text);
  } catch {
    return Result.fail(`${project.path} is not JSON`);
  }
  if (!record(config)) return Result.fail(`${project.path} holds no config object`);
  const environment: Record<string, unknown> = {};
  for (const key of ENVIRONMENT) if (config[key] !== undefined) environment[key] = config[key];
  if (config.jsPlugins === undefined) return Result.succeed(environment);
  if (!Array.isArray(config.jsPlugins)) return Result.fail(`${project.path} declares jsPlugins that are not a list`);
  const from = dirname(project.absolute);
  const plugins: unknown[] = [];
  for (const entry of config.jsPlugins) {
    const specifier =
      typeof entry === 'string' ? entry : record(entry) && typeof entry.specifier === 'string' ? entry.specifier : undefined;
    if (specifier === undefined)
      return Result.fail(`${project.path} declares a JS plugin that is neither a specifier nor {name, specifier}`);
    const path = resolved(specifier, from);
    if (Result.isFailure(path)) return Result.fail(path.failure);
    plugins.push(typeof entry === 'string' ? path.success : { ...entry, specifier: path.success });
  }
  return Result.succeed({ ...environment, jsPlugins: plugins });
};

type Governed = { readonly key: string; readonly plugin: string | null };

const governed = (id: string): Result.Result<Governed, string> => {
  const slash = id.startsWith('@') ? id.lastIndexOf('/') : id.indexOf('/');
  if (slash <= 0 || slash === id.length - 1) return Result.fail(`${id} names no plugin, while oxlint reports every rule as plugin/rule`);
  const prefix = id.slice(0, slash);
  const rule = id.slice(slash + 1);
  const alias = ALIASES.get(prefix);
  if (alias !== undefined) return Result.fail(`${id} is an alias oxlint reports as ${alias}/${rule}; bind that id`);
  if (prefix === 'import') return Result.fail(`${id} resolves other modules, which a files layout does not hold`);
  if (prefix === 'typescript' && TYPESCRIPT_AS_ESLINT.has(rule)) return Result.fail(`${id} runs in oxlint as eslint/${rule}; bind that id`);
  const packaged = PACKAGE_PREFIX.exec(prefix);
  const named =
    packaged === null
      ? undefined
      : packaged[1] !== undefined && packaged[2] !== undefined
        ? `${packaged[1]}/${packaged[2]}`
        : (packaged[1] ?? packaged[2]);
  if (named !== undefined) return Result.fail(`${id} names its plugin by package, which oxlint reports as ${named}/${rule}; bind that id`);
  const native = NATIVE.get(prefix);
  return Result.succeed(native === undefined ? { key: id, plugin: null } : { key: `${native}/${rule}`, plugin: native });
};

export const lawConfig = (
  project: { readonly path: string; readonly absolute: string; readonly text: string } | null,
  options: RuleOptions,
): Result.Result<string, string> => {
  const environment = project === null ? Result.succeed({}) : environmentOf(project);
  if (Result.isFailure(environment)) return Result.fail(environment.failure);
  const plugins = new Set<string>();
  const rules: Record<string, unknown> = {};
  for (const [id, params] of options) {
    const rule = governed(id);
    if (Result.isFailure(rule)) return Result.fail(rule.failure);
    if (rule.success.plugin !== null) plugins.add(rule.success.plugin);
    rules[rule.success.key] = ruleSetting(params);
  }
  return Result.succeed(
    JSON.stringify({ ...environment.success, plugins: [...plugins].sort(), categories: { correctness: 'off' }, rules }),
  );
};
