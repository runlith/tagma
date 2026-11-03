import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Effect } from 'effect';
import { keptComments } from '@runlith/bundle/bundle';
import { developerMarks } from '@runlith/tagma/adapter/host-modules';
import { entryPath, entryRefusal, EXECUTIONS_RUNTIME } from '../installation/contract/wire/archive.js';
import { INSTALL_FILE } from '../installation/contract/wire/layout.js';
import { type EntrySink, type TarEntry, walkTarball } from '../installation/archive/tarball.js';

export type Label = { readonly text: string; readonly by: string };

export type Unwanted = {
  readonly labels: readonly Label[];
  readonly paths: readonly string[];
  readonly comments: readonly string[];
  readonly root: string;
};

type Pattern = { readonly text: string; readonly said: string; readonly tokenStart: boolean; readonly tokenEnd: boolean };

const TOLD = 40;
const SHORTEST_COMMENT = 8;

const lowered = (bytes: Buffer): string => bytes.toString('latin1').toLowerCase();

const tokenCode = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 45;

const pattern = (text: string, said: string, whole: boolean): Pattern => {
  const spelled = lowered(Buffer.from(text, 'utf8'));
  return {
    text: spelled,
    said,
    tokenStart: whole && tokenCode(spelled.charCodeAt(0)),
    tokenEnd: whole && tokenCode(spelled.charCodeAt(spelled.length - 1)),
  };
};

const MAPPED = /\.(?:[cm]?[jt]s|css|html)$/u;

const INLINE_MAP = pattern('sourceMappingURL=data:', 'an inline source map', false);

const BANNER = /\n[ \t]*\/\/ (\S+\.(?:[cm]?[jt]sx?|svelte))\r?\n/u;

const escapedBeyondAscii = (text: string): string =>
  text.replace(/[^\u0000-\u007f]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export const pathSpellings = (path: string): readonly string[] => {
  const spelled = new Set<string>();
  for (const form of new Set([path, path.normalize('NFC'), path.normalize('NFD')])) {
    spelled.add(`${form}/`);
    spelled.add(`${form.replaceAll('/', '\\/')}\\/`);
    spelled.add(`${encodeURI(form)}/`);
    spelled.add(`${escapedBeyondAscii(form)}/`);
  }
  return [...spelled];
};

const commentPattern = (comment: string): Pattern | null => {
  const lines = comment.split('\n').map((line) => line.trim());
  const content = lines.find((line) => line.replace(/^\/\*!|^\*+\/?|\*\/$/gu, '').trim().length >= SHORTEST_COMMENT);
  const sought = content ?? lines[0]!;
  return sought.length < SHORTEST_COMMENT ? null : pattern(sought, `the comment "${sought.slice(0, 80)}" of its own source`, false);
};

const patternsOf = (unwanted: Unwanted): { readonly labels: readonly Pattern[]; readonly any: readonly Pattern[] } => {
  const labels = unwanted.labels.map((label) => pattern(label.text, `the label "${label.text}" that ${label.by} declares`, true));
  const paths = unwanted.paths.flatMap((path) =>
    pathSpellings(path).map((spelled) => pattern(spelled, `a path under ${path} of the machine that built it`, false)),
  );
  return { labels, any: [...labels, ...paths] };
};

const matched = (window: string, one: Pattern, final: boolean, base: number): 'found' | 'deferred' | null => {
  for (let at = window.indexOf(one.text); at >= 0; at = window.indexOf(one.text, at + 1)) {
    const end = at + one.text.length;
    if (end === window.length && !final) return 'deferred';
    if (at === 0 && base > 0) continue;
    const before = !one.tokenStart || at === 0 || !tokenCode(window.charCodeAt(at - 1));
    const after = !one.tokenEnd || end === window.length || !tokenCode(window.charCodeAt(end));
    if (before && after) return 'found';
  }
  return null;
};

const scanned = (path: string, patterns: readonly Pattern[], banners: boolean, found: (said: string) => void): EntrySink => {
  const keep = Math.max(256, ...patterns.map((one) => one.text.length)) + 1;
  const open = new Set(patterns);
  let seekingBanner = banners;
  let tail = '';
  let base = 0;
  const search = (window: string, final: boolean): void => {
    for (const one of open) {
      if (matched(window, one, final, base) !== 'found') continue;
      open.delete(one);
      found(`${path} carries ${one.said}`);
    }
    if (!seekingBanner) return;
    const banner = BANNER.exec(`${base === 0 ? '\n' : ''}${window}${final ? '\n' : ''}`);
    if (banner === null) return;
    seekingBanner = false;
    found(`${path} carries the module banner "// ${banner[1]}"`);
  };
  return {
    chunk: (bytes) => {
      if (open.size === 0 && !seekingBanner) return;
      const window = tail + lowered(bytes);
      search(window, false);
      const cut = Math.max(0, window.length - keep);
      tail = window.slice(cut);
      base += cut;
    },
    end: () => {
      if ((open.size > 0 || seekingBanner) && tail.length > 0) search(tail, true);
    },
  };
};

const entryTrouble = (entry: TarEntry, path: string, labels: readonly Pattern[]): readonly string[] => {
  const named = entryRefusal(entry);
  const name = lowered(Buffer.from(path, 'utf8'));
  return [
    ...(named === null ? [] : [named]),
    ...(path === EXECUTIONS_RUNTIME ? [`${path} is carried, and install-from clones it from the release's own bun`] : []),
    ...(entry.kind === 'file' && path.endsWith('.map') ? [`${path} is a source map`] : []),
    ...(entry.attributes.length === 0 ? [] : [`${path || entry.name} carries the extended attributes ${entry.attributes.join(', ')}`]),
    ...labels.flatMap((one) => (matched(name, one, true, 0) === 'found' ? [`the entry name ${path} carries ${one.said}`] : [])),
  ];
};

export const archiveTrouble = (archive: string, unwanted: Unwanted): Effect.Effect<readonly string[]> =>
  Effect.promise(async () => {
    const { labels, any } = patternsOf(unwanted);
    const comments = unwanted.comments.flatMap((comment) => commentPattern(comment) ?? []);
    const scripted = [INLINE_MAP, ...any, ...comments];
    const told = new Set<string>();
    const manifest = unwanted.root === '' ? INSTALL_FILE : `${unwanted.root}/${INSTALL_FILE}`;
    let rooted = false;
    const tell = (trouble: string): void => {
      told.add(trouble);
    };
    const read = await walkTarball(archive, (entry) => {
      const path = entryPath(entry.name);
      if (path === manifest) rooted = true;
      for (const trouble of entryTrouble(entry, path, labels)) tell(trouble);
      const script = MAPPED.test(path);
      const built = script && !`/${path}`.includes('/node_modules/');
      const sought = script ? scripted : any;
      return entry.kind === 'file' && entry.size > 0 && (sought.length > 0 || built) ? scanned(path, sought, built, tell) : null;
    }).then(
      () => null,
      (error: unknown) => `the archive could not be read through: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (read !== null) tell(read);
    if (!rooted) tell(`the archive holds no ${manifest}, so it carries no release where the application keeps one`);
    const all = [...told];
    return all.length <= TOLD ? all : [...all.slice(0, TOLD), `and ${all.length - TOLD} more`];
  });

export type DeveloperInput = { readonly input: string; readonly manifest: string };

const ownFiles = (inputs: readonly string[]): readonly string[] => [
  ...new Set(inputs.map((input) => input.split('?')[0]!).filter((input) => isAbsolute(input))),
];

export const developerInputs = (inputs: readonly string[]): Effect.Effect<readonly DeveloperInput[]> =>
  Effect.promise(async () => {
    const marked = developerMarks();
    const found = await Promise.all(ownFiles(inputs).map(async (input) => ({ input, mark: await marked(input) })));
    return found.flatMap(({ input, mark }) => (mark === null ? [] : [{ input, manifest: mark.manifest }]));
  });

const COMMENTED = /\.[cm]?[jt]s$/u;

const generated = (error: NodeJS.ErrnoException): null => {
  if (error.code === 'ENOENT') return null;
  throw error;
};

export const sourceComments = (inputs: readonly string[], checkout: string): Effect.Effect<readonly string[], string> =>
  Effect.tryPromise({
    try: async () => {
      const own = ownFiles(inputs).filter(
        (input) => input.startsWith(`${checkout}/`) && !input.includes('/node_modules/') && COMMENTED.test(input),
      );
      const texts = await Promise.all(own.map(async (input) => [input, await readFile(input, 'utf8').catch(generated)] as const));
      return [...new Set(texts.flatMap(([input, text]) => (text === null ? [] : keptComments(input, text))))];
    },
    catch: (error) => `the comments of the sources it carries could not be read: ${error instanceof Error ? error.message : String(error)}`,
  });
