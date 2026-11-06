export const UI_MODULE = '@runlith/tagma/ui';

const NOT_HOSTED: ReadonlySet<string> = new Set(['./package.json', './compiler', './server', './internal', './internal/server']);

const loadable = (conditions: unknown): boolean =>
  typeof conditions === 'string' ||
  (typeof conditions === 'object' && conditions !== null && Object.keys(conditions).some((name) => name !== 'types'));

export const hostModules = (svelteExports: Readonly<Record<string, unknown>>): readonly string[] => [
  ...Object.entries(svelteExports).flatMap(([key, conditions]) =>
    NOT_HOSTED.has(key) || key.includes('*') || !loadable(conditions) ? [] : [key === '.' ? 'svelte' : `svelte/${key.slice(2)}`],
  ),
  UI_MODULE,
];

export const hostFile = (specifier: string): string => `_app/host/${specifier.replace(/^@/u, '').replaceAll('/', '_')}.js`;
