import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { defineConfig, type ConfigEnv, type UserWorkspaceConfig, type ViteUserConfig, type ViteUserConfigExport } from 'vitest/config';
import { packagesOf, workspacePaths } from './packages.ts';
import { vitestConfigsOf, type VitestConfig } from './vitestConfigs.ts';

const root = resolve(import.meta.dirname, '../..');
const paths = workspacePaths(root);
const configs = vitestConfigsOf(
  packagesOf(paths, (path) => readFileSync(resolve(root, path), 'utf8')),
  paths,
);

async function projects(source: VitestConfig, env: ConfigEnv): Promise<UserWorkspaceConfig[]> {
  const path = resolve(root, source.file);
  const loaded = (await import(path)) as { readonly default: ViteUserConfigExport };
  const config: ViteUserConfig = await (typeof loaded.default === 'function' ? loaded.default(env) : loaded.default);
  const directory = resolve(root, source.directory);
  const suite = basename(directory);
  const local = config.test?.projects ?? [{ test: { name: source.file.endsWith('.bench.config.ts') ? 'bench' : 'unit' } }];
  return local.map((project) => {
    if (typeof project !== 'object' || project === null || project instanceof Promise) {
      throw new Error(`The shared Vitest run requires inline projects in ${source.file}.`);
    }
    const name = project.test?.name;
    if (typeof name !== 'string') throw new Error(`The Vitest project in ${source.file} needs a string name.`);
    return {
      extends: path,
      root: directory,
      test: { ...project.test, name: `${suite}:${name}` },
    };
  });
}

export default defineConfig(async (env) => ({
  root,
  test: {
    maxWorkers: 2,
    projects: (await Promise.all(configs.map((config) => projects(config, env)))).flat(),
  },
}));
