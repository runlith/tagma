import { join } from 'node:path';
import type { Package } from './packages.ts';

export type VitestConfig = {
  readonly directory: string;
  readonly file: string;
};

export function vitestConfigsOf(packages: readonly Package[], paths: readonly string[]): VitestConfig[] {
  const files = new Set(paths);
  return packages
    .filter((pkg) => pkg.dir.startsWith('packages/') && pkg.runner === 'vitest')
    .sort((left, right) => left.dir.localeCompare(right.dir))
    .flatMap((pkg) => {
      const configs = new Set<string>();
      const main = ['vitest.config.ts', 'vite.config.ts'].map((file) => join(pkg.dir, file)).find((file) => files.has(file));
      if (main !== undefined) configs.add(main);
      const flags = (pkg.scripts.test ?? '').matchAll(/(?:^|\s)--config(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s&;]+))/g);
      for (const flag of flags) {
        const file = join(pkg.dir, flag[1] ?? flag[2] ?? flag[3]!);
        if (!files.has(file)) throw new Error(`${pkg.dir}:test names missing Vitest config ${file}`);
        configs.add(file);
      }
      if (configs.size === 0) throw new Error(`${pkg.dir}:test has no workspace Vitest config`);
      return [...configs].map((file) => ({ directory: pkg.dir, file }));
    });
}
