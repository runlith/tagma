import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import { type BlockFile, decodeBlockFile, encodeBlockFile } from './blockFile.js';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export type TreeBlock = BlockFile & { readonly parentId: string | null };

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

export function renderBlockTree(blocks: readonly TreeBlock[]): Effect.Effect<RenderedTree, BlockTreeUnreadable> {
  const byParent = new Map<string | null, TreeBlock[]>();
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
    const siblings = byParent.get(block.parentId) ?? [];
    siblings.push(block);
    byParent.set(block.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.frontmatter.ord - b.frontmatter.ord || a.frontmatter.id.localeCompare(b.frontmatter.id));
  }
  const files = new Map<string, string>();
  const paths = new Map<string, string>();
  const emit = (prefix: string, parentId: string | null): void => {
    const taken = new Set<string>();
    for (const block of byParent.get(parentId) ?? []) {
      const name = sibling(block.frontmatter.id, block.frontmatter.title, taken);
      const text = encodeBlockFile(block);
      if (byParent.has(block.frontmatter.id)) {
        const rel = prefix === '' ? `${name}/${INDEX}` : `${prefix}/${name}/${INDEX}`;
        files.set(rel, text);
        paths.set(block.frontmatter.id, rel);
        emit(prefix === '' ? name : `${prefix}/${name}`, block.frontmatter.id);
      } else {
        const rel = prefix === '' ? `${name}.md` : `${prefix}/${name}.md`;
        files.set(rel, text);
        paths.set(block.frontmatter.id, rel);
      }
    }
  };
  emit('', null);
  return Effect.succeed({ files, paths });
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

export const visitBlockTree = (root: string, visit: (block: ScannedBlock) => void) => {
  const walk = Effect.fnUntraced(function* (
    dir: string,
    prefix: string,
    parentId: string | null,
  ): Effect.fn.Return<void, BlockTreeUnreadable> {
    const entries = yield* Effect.try({
      try: () => readdirSync(dir, { withFileTypes: true }),
      catch: (error) =>
        new BlockTreeUnreadable({ reason: 'io', path: dir, message: error instanceof Error ? error.message : String(error) }),
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        const index = join(path, INDEX);
        const listing = readdirSync(path);
        if (!listing.includes(INDEX)) {
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
  return walk(root, '', null);
};

export const readBlockTree = Effect.fnUntraced(function* (root: string) {
  const rows: ScannedBlock[] = [];
  yield* visitBlockTree(root, (block) => rows.push(block));
  return rows;
});
