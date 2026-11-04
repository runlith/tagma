import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const workspacePaths = (root: string): string[] => {
  const git = Bun.spawnSync(['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (git.exitCode !== 0) throw new Error(git.stderr.toString());
  return [...new Set(git.stdout.toString().split('\0'))].filter(
    (path) => path !== '' && !path.startsWith('.git/') && existsSync(join(root, path)),
  );
};

export type Package = {
  readonly dir: string;
  readonly runner: 'bun' | 'vitest';
  readonly manifest: string;
  readonly externalInputs: Readonly<Record<string, string>>;
  readonly loads: Readonly<Record<string, readonly string[]>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly os: readonly string[] | undefined;
};

export const runsOn = (pkg: Package, platform: string = process.platform): boolean =>
  pkg.os === undefined || (!pkg.os.includes(`!${platform}`) && (pkg.os.includes(platform) || pkg.os.every((one) => one.startsWith('!'))));

export const packagesOf = (paths: readonly string[], read: (path: string) => string): Package[] => {
  const root = JSON.parse(read('package.json')) as { readonly workspaces?: readonly string[] | { readonly packages: readonly string[] } };
  const patterns = root.workspaces === undefined ? [] : 'packages' in root.workspaces ? root.workspaces.packages : root.workspaces;
  return paths
    .filter((path) => /(?:^|\/)package.json$/.test(path) && !path.startsWith('.'))
    .filter((path) => path === 'package.json' || patterns.some((pattern) => new Bun.Glob(pattern).match(dirname(path))))
    .map((manifest) => {
      const parsed = JSON.parse(read(manifest)) as {
        readonly os?: readonly string[];
        readonly scripts?: Readonly<Record<string, string>>;
        readonly changeCheck?: {
          readonly externalInputs?: Readonly<Record<string, string>>;
          readonly loads?: Readonly<Record<string, readonly string[]>>;
        };
      };
      return {
        dir: manifest === 'package.json' ? '' : dirname(manifest),
        manifest,
        scripts: parsed.scripts ?? {},
        os: parsed.os,
        externalInputs: parsed.changeCheck?.externalInputs ?? {},
        loads: parsed.changeCheck?.loads ?? {},
        runner: /\bvitest\b/.test(parsed.scripts?.test ?? '') ? ('vitest' as const) : ('bun' as const),
      };
    })
    .sort((a, b) => b.dir.length - a.dir.length);
};
