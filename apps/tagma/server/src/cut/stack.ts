import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { isRelease } from '../installation/contract/wire/feed.js';
import type { Channel } from '../installation/contract/wire/channel.js';
import { dataDirectory } from '../installation/contract/wire/layout.js';
import { KEPT_MAPS, RELEASE_DIRECTORY } from './pipeline.js';
import { decodeRecord, MAPS, RELEASE_RECORD } from './stage.js';

const FRAME =
  /\((?<within>[^()\n]+):(?<withinLine>\d+):(?<withinColumn>\d+)\)|^(?<lead>[ \t]*at[ \t]+|[^@\n(]*@)(?<bare>[^()\n]+?):(?<bareLine>\d+):(?<bareColumn>\d+)[ \t]*$/gmu;
const LOCATED = /^(?:\/|[a-z][a-z0-9+.-]*:\/\/)/u;
const UNMAPPED = -1;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGITS = new Map([...BASE64].map((char, at) => [char.charCodeAt(0), at]));

type Segment = readonly [column: number, source: number, line: number, origin: number];
type SourceMap = { readonly sources: readonly string[]; readonly mappings: string };
type Frame = { readonly at: number; readonly length: number; readonly path: string; readonly line: number; readonly column: number };

export type Decoded = { readonly text: string; readonly frames: number; readonly read: number };

export class StackRefused extends Error {
  constructor(
    readonly code: string,
    readonly reason: string,
    readonly unblock: readonly string[],
  ) {
    super(reason);
  }
}

const framePath = (spelled: string): string => {
  if (spelled.startsWith('/')) return spelled;
  if (spelled.startsWith('file://')) return fileURLToPath(spelled);
  return decodeURIComponent(new URL(spelled).pathname);
};

const mapsUnder = async (root: string, within = ''): Promise<string[]> => {
  const entries = await readdir(join(root, within), { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const relative = within === '' ? entry.name : `${within}/${entry.name}`;
      if (entry.isDirectory()) return mapsUnder(root, relative);
      return Promise.resolve(entry.name.endsWith('.map') ? [relative.slice(0, -'.map'.length)] : []);
    }),
  );
  return found.flat();
};

const sharedTail = (path: string, key: string): number => {
  const ours = path.split('/');
  const theirs = key.split('/');
  let shared = 0;
  while (shared < theirs.length && shared < ours.length && ours[ours.length - 1 - shared] === theirs[theirs.length - 1 - shared])
    shared += 1;
  return shared;
};

const keyOf = (path: string, byName: ReadonlyMap<string, readonly string[]>): string | null => {
  const scored = (byName.get(basename(path)) ?? []).map((key) => ({ key, shared: sharedTail(path, key) }));
  const best = Math.max(0, ...scored.map((one) => one.shared));
  const top = scored.filter((one) => one.shared === best);
  return best === 0 || top.length !== 1 ? null : top[0]!.key;
};

const segmentsUpTo = (mappings: string, last: number): Segment[][] => {
  const lines: Segment[][] = [[]];
  const state = [0, 0, 0, 0, 0];
  let field = 0;
  let value = 0;
  let shift = 0;
  let segment: number[] = [];
  const close = () => {
    if (segment.length >= 4) lines[lines.length - 1]!.push([segment[0]!, segment[1]!, segment[2]!, segment[3]!]);
    else if (segment.length > 0) lines[lines.length - 1]!.push([segment[0]!, UNMAPPED, 0, 0]);
    segment = [];
    field = 0;
  };
  for (let at = 0; at < mappings.length; at += 1) {
    const code = mappings.charCodeAt(at);
    if (code === 59) {
      close();
      if (lines.length > last) return lines;
      lines.push([]);
      state[0] = 0;
      continue;
    }
    if (code === 44) {
      close();
      continue;
    }
    const digit = DIGITS.get(code);
    if (digit === undefined) throw new Error(`the mappings hold ${mappings[at]} at ${at}, which is no base64 digit`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const delta = value & 1 ? -(value >>> 1) : value >>> 1;
    state[field] = state[field]! + delta;
    segment.push(state[field]!);
    field += 1;
    value = 0;
    shift = 0;
  }
  close();
  return lines;
};

const located = (lines: readonly Segment[][], line: number, column: number): Segment | null => {
  const segments = lines[line] ?? [];
  let low = 0;
  let high = segments.length - 1;
  let found: Segment | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle]![0] <= column) {
      found = segments[middle]!;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
};

const shown = (source: string, checkout: string): string => (source.startsWith(`${checkout}/`) ? relative(checkout, source) : source);

export const decodeStack = async (maps: string, text: string, checkout: string): Promise<Decoded> => {
  const keys = await mapsUnder(maps);
  const byName = new Map<string, string[]>();
  for (const key of keys) byName.set(basename(key), [...(byName.get(basename(key)) ?? []), key]);
  const frames: Frame[] = [...text.matchAll(FRAME)].flatMap((match) => {
    const named = match.groups!;
    const within = named.within !== undefined;
    const spelled = within ? named.within! : named.bare!;
    if (!LOCATED.test(spelled)) return [];
    const line = within ? named.withinLine! : named.bareLine!;
    const column = within ? named.withinColumn! : named.bareColumn!;
    return [
      {
        at: match.index + (within ? 1 : named.lead!.length),
        length: `${spelled}:${line}:${column}`.length,
        path: framePath(spelled),
        line: Number(line) - 1,
        column: Number(column) - 1,
      },
    ];
  });
  const wanted = new Map<string, number>();
  const keyed = frames.map((frame) => {
    const key = keyOf(frame.path, byName);
    if (key !== null) wanted.set(key, Math.max(wanted.get(key) ?? 0, frame.line));
    return key;
  });
  const decoded = new Map<string, { readonly map: SourceMap; readonly lines: Segment[][] }>();
  for (const [key, last] of wanted) {
    const path = join(maps, `${key}.map`);
    const written = await readFile(path, 'utf8');
    try {
      const map = JSON.parse(written) as SourceMap;
      decoded.set(key, { map, lines: segmentsUpTo(map.mappings, last) });
    } catch (error) {
      throw new StackRefused(
        'map-unreadable',
        `${path} does not read as a source map: ${error instanceof Error ? error.message : String(error)}`,
        ['cut the release again to write its maps anew; its stacks are read against the maps that release wrote'],
      );
    }
  }
  let told = '';
  let cursor = 0;
  let read = 0;
  frames.forEach((frame, index) => {
    const key = keyed[index];
    const held = key === null || key === undefined ? undefined : decoded.get(key);
    const segment = held === undefined ? null : located(held.lines, frame.line, frame.column);
    if (held === undefined || segment === null || segment[1] === UNMAPPED) return;
    const source = held.map.sources[segment[1]];
    if (source === undefined) return;
    told += `${text.slice(cursor, frame.at)}${shown(source, checkout)}:${segment[2] + 1}:${segment[3] + 1}`;
    cursor = frame.at + frame.length;
    read += 1;
  });
  return { text: told + text.slice(cursor), frames: frames.length, read };
};

const USAGE = 'bun run tagma:stack <version> < stack.txt';

const directory = (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isDirectory(),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

const cutMaps = async (cut: string, release: string): Promise<string | null> => {
  if (!existsSync(join(cut, RELEASE_RECORD))) return null;
  const home = await realpath(cut);
  const path = join(home, RELEASE_RECORD);
  const read = decodeRecord(await readFile(path, 'utf8'));
  if (read._tag === 'Failure')
    throw new StackRefused('unreadable', `${path} does not read as a release record: ${read.failure.message}`, ['bun run tagma:release']);
  return read.success.release === release ? join(home, MAPS) : null;
};

export const stackCommand = async (checkout: string, given: readonly string[], developer: Channel): Promise<void> => {
  const [release, ...extra] = given;
  const data = dataDirectory(developer, process.env);
  try {
    if (release === undefined || extra.length > 0)
      throw new StackRefused('usage', 'a stack is read against the maps of one release', [USAGE]);
    if (!isRelease(release)) throw new StackRefused('usage', `${release} is no version`, [USAGE]);
    if (data === null) throw new StackRefused('no-home', 'HOME names no home directory, so where maps are kept is unknown', [USAGE]);
    const kept = join(data, KEPT_MAPS, release);
    const cut = join(data, RELEASE_DIRECTORY);
    const maps = (await directory(kept)) ? kept : await cutMaps(cut, release);
    if (maps === null) {
      throw new StackRefused('no-maps', `no source maps of ${release} are kept in ${kept}, and the release cut in ${cut} is another`, [
        `the machine that published ${release} keeps its maps in ${join('<its data directory>', KEPT_MAPS, release)}`,
      ]);
    }
    const decoded = await decodeStack(maps, await Bun.stdin.text(), checkout);
    process.stdout.write(decoded.text);
    console.error(`[tagma] ${decoded.read} of ${decoded.frames} frames read from the maps of release ${release}`);
  } catch (error) {
    if (!(error instanceof StackRefused)) throw error;
    console.error(refusalLines({ code: error.code, reason: error.reason, unblock: [...error.unblock] }).join('\n'));
    process.exit(2);
  }
};
