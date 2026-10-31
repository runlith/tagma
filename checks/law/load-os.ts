import { defineInspection, defineProgram, type Finding, type Reading, type Side } from '@runlith/tagma/rules';

export const loadOs = defineInspection<Record<string, never>>({ program: 'checks/law/load-os.ts', name: 'load-os', concern: 'code' });

const markers = [
  { name: 'darwin', pattern: /\bdarwin\b/ },
  { name: 'win32', pattern: /\bwin32\b/ },
  { name: 'linux', pattern: /\blinux\b/ },
  { name: '.app/', pattern: /\.app\// },
  { name: '/bin/ps', pattern: /\/bin\/ps\b/ },
  { name: '/proc', pattern: /\/proc(?![\w-])/ },
  { name: 'Mac', pattern: /\bMac\b/ },
];

const reading = async (side: Side): Promise<Reading> => {
  const findings: Finding[] = [];
  for (const path of side.paths) {
    if (/\.(?:test|itest|e2e|stest|spec|bench|fixture)\.[^.]+$/.test(path) || /(?:^|\/)(?:testing|fixtures)\//.test(path)) continue;
    const text = await side.read(path);
    if (text === null) continue;
    const lines = text.split('\n');
    for (const { name, pattern } of markers) {
      const sites = lines.flatMap((line, index) => (pattern.test(line) ? [{ line: index + 1 }] : []));
      if (sites.length === 0) continue;
      findings.push({
        fingerprint: `load-os:${name}:${path}`,
        path,
        line: sites[0]!.line,
        sites,
        message: `names ${name} in Load core`,
        fix: 'Move the platform-specific behavior into an adapter and read it through the usage port.',
      });
    }
  }
  return { findings };
};

export default defineProgram<{ 'load-os': Record<string, never> }>({
  'load-os': async ({ tree, base }) => ({ tree: await reading(tree), base: base === null ? undefined : await reading(base) }),
});
