import fs, { readFileSync } from 'node:fs';
import { delimiter, dirname, posix, relative, resolve, sep } from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
import { ResolverFactory } from 'enhanced-resolve';
import { compile } from 'tailwindcss';
import { stylesheetKey, utilitiesSource, type Stylesheet, type WindowUtilities } from '@tagma/server/views/contract/wire/utilities';

type Loaded = { readonly path: string; readonly base: string; readonly content: string };

export const sourceLines = (stylesheet: string, sources: readonly string[]): string[] =>
  sources.flatMap((source) => {
    const path = relative(dirname(stylesheet), source);
    return [`@source "${path}/**/*.svelte";`, `@source "${path}/**/*.ts";`];
  });

const resolverOver = () =>
  ResolverFactory.createResolver({
    fileSystem: fs,
    extensions: ['.css'],
    mainFields: ['style'],
    conditionNames: ['style'],
    modules: ['node_modules', ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(delimiter) : [])],
  });

const stylesheetLoader = () => {
  const resolver = resolverOver();
  return (id: string, base: string): Promise<Loaded> =>
    new Promise((done, fail) => {
      resolver.resolve({}, base, id, {}, (error, path) => {
        if (error) return fail(error);
        if (typeof path !== 'string') return fail(new Error(`Could not resolve '${id}' from '${base}'`));
        done({ path, base: dirname(path), content: readFileSync(path, 'utf8') });
      });
    });
};

const underRoot = (root: string, path: string): string => relative(root, path).split(sep).join(posix.sep) || '.';

const recordingLoader = (root: string, stylesheets: Record<string, Stylesheet>) => {
  const load = stylesheetLoader();
  return async (id: string, base: string): Promise<Stylesheet> => {
    const sheet = await load(id, resolve(root, base));
    const recorded = { path: underRoot(root, sheet.path), base: underRoot(root, sheet.base), content: sheet.content };
    stylesheets[stylesheetKey(id, base)] = recorded;
    return recorded;
  };
};

const replayingLoader =
  (stylesheets: Readonly<Record<string, Stylesheet>>) =>
  async (id: string, base: string): Promise<Stylesheet> => {
    const recorded = stylesheets[stylesheetKey(id, base)];
    if (recorded === undefined) throw new Error(`The recorded stylesheets hold no '${id}' from '${base}'`);
    return recorded;
  };

const scanned = async (stylesheet: string, extraSources: readonly string[], root: string): Promise<string[]> => {
  const css = `${readFileSync(stylesheet, 'utf8')}\n${sourceLines(stylesheet, extraSources).join('\n')}\n`;
  const compiled = await compile(css, { base: dirname(stylesheet), loadStylesheet: stylesheetLoader() });
  const own =
    compiled.root === 'none'
      ? []
      : compiled.root === null
        ? [{ base: root, pattern: '**/*', negated: false }]
        : [{ ...compiled.root, negated: false }];
  return new Scanner({ sources: [...own, ...compiled.sources] }).scan().sort();
};

export async function windowUtilities(root: string, stylesheet: string, extraSources: readonly string[]): Promise<WindowUtilities> {
  const candidates = await scanned(stylesheet, extraSources, root);
  const entry = `./${underRoot(root, stylesheet)}`;
  const source = utilitiesSource(entry);
  const stylesheets: Record<string, Stylesheet> = {};
  const recorded = (await compile(source, { base: '.', loadStylesheet: recordingLoader(root, stylesheets) })).build(candidates);
  const replayed = (await compile(source, { base: '.', loadStylesheet: replayingLoader(stylesheets) })).build(candidates);
  if (replayed !== recorded) throw new Error('The recorded stylesheets of the window do not replay to the sheet they were recorded from');
  return { entry, candidates, stylesheets };
}

export function inlineSources(candidates: readonly string[]): { readonly css: string; readonly dropped: number } {
  const double: string[] = [];
  const single: string[] = [];
  let dropped = 0;
  for (const candidate of candidates) {
    if (/[{}]/u.test(candidate) || (candidate.includes('"') && candidate.includes("'"))) dropped += 1;
    else (candidate.includes('"') ? single : double).push(candidate);
  }
  const lines = [
    ...(double.length === 0 ? [] : [`@source inline("${double.join(' ')} ");`]),
    ...(single.length === 0 ? [] : [`@source inline('${single.join(' ')} ');`]),
  ];
  return { css: lines.join('\n'), dropped };
}
