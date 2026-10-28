import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import { type BlockFile, FILE_IDENTITY, decodeBlockFile, encodeBlockFile } from './blockFile.js';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import { STEALTH_PREFIX, inStealth, stealthRelative } from '../contract/wire/storage.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export type TreeBlock = BlockFile & { readonly parentId: string | null };

export type TreeRoots = { readonly root: string; readonly stealth: string | null };

export const fileIn = (roots: TreeRoots, path: string): string => {
  if (!inStealth(path)) return join(roots.root, path);
  if (roots.stealth === null) throw new Error(`${path} belongs to the stealth tree, and this copy serves none`);
  return join(roots.stealth, stealthRelative(path));
};

export type ScannedBlock = TreeBlock & { readonly path: string };

export class BlockTreeUnreadable extends Data.TaggedError('BlockTreeUnreadable')<{
  readonly reason: 'io' | 'file' | 'orphan' | 'unmerged';
  readonly path: string;
  readonly message: string;
}> {}

export const unmergedRefusal = (path: string): GateRefusal<'graph-unmerged'> =>
  new GateRefusal(
    'graph-unmerged',
    `${path} holds git conflict markers: a merge of the graph was not finished, so the graph cannot be read`,
    [
      `resolve the conflict in ${path} — keep what each side means and drop the <<<<<<< ======= >>>>>>> lines — then finish the merge with git add and git commit`,
      'or abandon the merge with git merge --abort',
    ],
  );

const INDEX = 'index.md';

function holdsBlockFiles(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && holdsBlockFiles(join(dir, entry.name))) return true;
    if (entry.isFile() && entry.name.endsWith('.md')) return true;
  }
  return false;
}

export function holdsBlocks(root: string): boolean {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(join(path, INDEX)) || holdsBlockFiles(path)) return true;
    } else if (entry.name.endsWith('.md') && entry.name !== INDEX) return true;
  }
  return false;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function sibling(id: string, title: string, taken: Set<string>): string {
  const compact = id.replaceAll('-', '');
  const slug = slugify(title);
  const bare = slug !== '' && slug !== 'index';
  const suffixed = (length: number) => (bare ? `${slug}-${compact.slice(-length)}` : compact.slice(-length));
  let name = bare ? slug : suffixed(SPOKEN_LENGTH);
  for (let length = SPOKEN_LENGTH; taken.has(name) && length <= compact.length; length += 4) {
    name = suffixed(length);
  }
  taken.add(name);
  return name;
}

export function shelfNames(
  siblings: readonly { readonly id: string; readonly title: string; readonly ord: number }[],
): Map<string, string> {
  const sorted = [...siblings].sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const member of sorted) out.set(member.id, sibling(member.id, member.title, taken));
  return out;
}

export type RenderedTree = {
  readonly files: Map<string, string>;
  readonly paths: Map<string, string>;
};

const shelvesOf = (blocks: readonly TreeBlock[]): Map<string | null, TreeBlock[]> => {
  const byParent = new Map<string | null, TreeBlock[]>();
  for (const block of blocks) {
    const siblings = byParent.get(block.parentId) ?? [];
    siblings.push(block);
    byParent.set(block.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.frontmatter.ord - b.frontmatter.ord || a.frontmatter.id.localeCompare(b.frontmatter.id));
  }
  return byParent;
};

const emitShelf = (byParent: ReadonlyMap<string | null, readonly TreeBlock[]>, rendered: RenderedTree) => {
  const emit = (prefix: string, members: readonly TreeBlock[]): void => {
    const taken = new Set<string>();
    for (const block of members) {
      const name = sibling(block.frontmatter.id, block.frontmatter.title, taken);
      const text = encodeBlockFile(block);
      const children = byParent.get(block.frontmatter.id);
      const place = prefix === '' ? name : `${prefix}/${name}`;
      const rel = children === undefined ? `${place}.md` : `${place}/${INDEX}`;
      rendered.files.set(rel, text);
      rendered.paths.set(block.frontmatter.id, rel);
      if (children !== undefined) emit(place, children);
    }
  };
  return emit;
};

export function renderBlockTree(blocks: readonly TreeBlock[]): Effect.Effect<RenderedTree, BlockTreeUnreadable> {
  const ids = new Set(blocks.map((block) => block.frontmatter.id));
  for (const block of blocks) {
    if (block.parentId !== null && !ids.has(block.parentId)) {
      return Effect.fail(
        new BlockTreeUnreadable({
          reason: 'orphan',
          path: '',
          message: `block ${block.frontmatter.id} names an absent parent ${block.parentId}`,
        }),
      );
    }
  }
  const byParent = shelvesOf(blocks);
  const rendered: RenderedTree = { files: new Map(), paths: new Map() };
  emitShelf(byParent, rendered)('', byParent.get(null) ?? []);
  return Effect.succeed(rendered);
}

export function renderForest(blocks: readonly TreeBlock[], anchorOf: (block: TreeBlock) => string): RenderedTree {
  const ids = new Set(blocks.map((block) => block.frontmatter.id));
  const nested = (block: TreeBlock): boolean => block.parentId !== null && ids.has(block.parentId);
  const byParent = shelvesOf(blocks.filter(nested));
  const tops = shelvesOf(blocks.filter((block) => !nested(block)).map((block) => ({ ...block, parentId: anchorOf(block) })));
  const rendered: RenderedTree = { files: new Map(), paths: new Map() };
  const emit = emitShelf(byParent, rendered);
  for (const [anchor, members] of tops) if (anchor !== null) emit(anchor, members);
  return rendered;
}

export function writeBlockTree(root: string, blocks: readonly TreeBlock[]): Effect.Effect<void, BlockTreeUnreadable> {
  return Effect.flatMap(renderBlockTree(blocks), ({ files }) =>
    Effect.try({
      try: () => {
        mkdirSync(root, { recursive: true });
        for (const [rel, text] of files) {
          const path = join(root, rel);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
        }
      },
      catch: (error) =>
        new BlockTreeUnreadable({ reason: 'io', path: root, message: error instanceof Error ? error.message : String(error) }),
    }),
  );
}

const decode = (path: string): Effect.Effect<BlockFile, BlockTreeUnreadable> =>
  Effect.try({
    try: () => readFileSync(path, 'utf8'),
    catch: (error) => new BlockTreeUnreadable({ reason: 'io', path, message: error instanceof Error ? error.message : String(error) }),
  }).pipe(
    Effect.flatMap((text) =>
      decodeBlockFile(text).pipe(
        Effect.mapError(
          (error) =>
            new BlockTreeUnreadable({
              reason: error.reason === 'conflict-markers' ? 'unmerged' : 'file',
              path,
              message: `${error.reason}: ${error.message}`,
            }),
        ),
      ),
    ),
  );

const listing = (dir: string) =>
  Effect.try({
    try: () => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)),
    catch: (error) => new BlockTreeUnreadable({ reason: 'io', path: dir, message: error instanceof Error ? error.message : String(error) }),
  });

export const visitForest = Effect.fnUntraced(function* (root: string, visit: (block: ScannedBlock) => void) {
  if (!existsSync(root)) return;
  for (const entry of yield* listing(root)) {
    if (entry.name.startsWith('.')) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory() && FILE_IDENTITY.test(entry.name)) {
      yield* walkBlockTree(path, entry.name, entry.name, visit);
      continue;
    }
    if (entry.isFile() ? entry.name.endsWith('.md') : holdsBlockFiles(path)) {
      return yield* new BlockTreeUnreadable({
        reason: 'orphan',
        path,
        message: 'a stealth tree keeps its blocks in directories named by the uuid of their parent, and this one stands outside them',
      });
    }
  }
});

export const visitBlockTree = (root: string, visit: (block: ScannedBlock) => void) => walkBlockTree(root, '', null, visit);

const walkBlockTree = (root: string, base: string, top: string | null, visit: (block: ScannedBlock) => void) => {
  const walk = Effect.fnUntraced(function* (
    dir: string,
    prefix: string,
    parentId: string | null,
  ): Effect.fn.Return<void, BlockTreeUnreadable> {
    for (const entry of yield* listing(dir)) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        const index = join(path, INDEX);
        if (!readdirSync(path).includes(INDEX)) {
          if (holdsBlockFiles(path)) {
            return yield* new BlockTreeUnreadable({
              reason: 'orphan',
              path,
              message: 'a directory holds block files but no index.md names their parent',
            });
          }
          continue;
        }
        const file = yield* decode(index);
        visit({ ...file, parentId, path: `${rel}/${INDEX}` });
        yield* walk(path, rel, file.frontmatter.id);
        continue;
      }
      if (!entry.name.endsWith('.md') || entry.name === INDEX) continue;
      const file = yield* decode(path);
      visit({ ...file, parentId, path: rel });
    }
  });
  return walk(root, base, top);
};

export const readBlockTree = Effect.fnUntraced(function* (root: string, stealth: string | null = null) {
  const rows: ScannedBlock[] = [];
  yield* visitBlockTree(root, (block) => rows.push(block));
  if (stealth !== null) yield* visitForest(stealth, (block) => rows.push({ ...block, path: `${STEALTH_PREFIX}${block.path}` }));
  return rows;
});
