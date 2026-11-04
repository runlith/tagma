export type Kind = 'unit' | 'resource' | 'e2e';

const RESOURCE = /\.itest\.[cm]?[jt]sx?$/;
const E2E = /\.e2e\.ts$/;
const PLATFORMS = /\.((?:(?:aix|android|darwin|freebsd|haiku|linux|openbsd|sunos|win32)\.)+)(?:test|itest|e2e|spec)\.[cm]?[jt]sx?$/;

export const runsOnPlatform = (file: string, platform: string = process.platform): boolean => {
  const matched = PLATFORMS.exec(file);
  return matched === null || matched[1]!.split('.').includes(platform);
};

export const kindOf = (file: string): Kind => (E2E.test(file) ? 'e2e' : RESOURCE.test(file) ? 'resource' : 'unit');

const SKIPPED = new Set(['node_modules', 'build', 'dist', 'coverage', 'out', 'target']);

export const runsAs = (kind: Kind, path: string, isPackage: (directory: string) => boolean): boolean => {
  const parts = path.split('/');
  if (kindOf(path) !== kind || parts.some((part) => part.startsWith('.') || SKIPPED.has(part))) return false;
  for (let depth = 1; depth < parts.length; depth++) if (isPackage(parts.slice(0, depth).join('/'))) return false;
  return true;
};

export const HANG_MS = 180_000;

export const SLOW_MS: Readonly<Record<Kind, number>> = { unit: 1_000, resource: 10_000, e2e: 10_000 };
