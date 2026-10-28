import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { flushDirectoriesSync, isStaging, stagingOf, writeAtomicSync } from './atomicFile.js';
import { ExportFailed, exportGraphRows, groupConnections } from './export.js';
import { BlockTreeUnreadable, renderBlockTree, renderForest } from './layout.js';
import { STEALTH_PREFIX, anchorOf } from '../contract/wire/storage.js';
import type { ProjectionAnswer, ProjectionAsk, ProjectionJob, ProjectionReply } from './projection.js';

declare const self: Worker;

function applyTreeFiles(root: string, target: ReadonlyMap<string, string>): { readonly written: number; readonly removed: number } {
  mkdirSync(root, { recursive: true });
  let written = 0;
  let removed = 0;
  const existing: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) {
        if (entry.isFile() && isStaging(entry.name)) rmSync(join(dir, entry.name));
        continue;
      }
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.name.endsWith('.md')) existing.push(rel);
    }
  };
  walk(root, '');
  for (const rel of existing) {
    if (target.has(rel)) continue;
    rmSync(join(root, rel));
    removed += 1;
  }
  const touched = new Set<string>();
  for (const [rel, text] of target) {
    const path = join(root, rel);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    for (const directory of writeAtomicSync(path, stagingOf(path), text)) touched.add(directory);
    written += 1;
  }
  flushDirectoriesSync(touched);
  const prune = (dir: string): boolean => {
    let empty = true;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '.git') {
        if (prune(join(dir, entry.name))) continue;
      }
      empty = false;
    }
    if (empty && dir !== root) {
      rmdirSync(dir);
      return true;
    }
    return false;
  };
  prune(root);
  return { written, removed };
}

const applied = (root: string, files: ReadonlyMap<string, string>) =>
  Effect.try({
    try: () => applyTreeFiles(root, files),
    catch: (error) =>
      new BlockTreeUnreadable({ reason: 'io', path: root, message: error instanceof Error ? error.message : String(error) }),
  });

const project = Effect.fnUntraced(function* (job: ProjectionJob) {
  const tree = yield* exportGraphRows(job.blocks, groupConnections(job.connections));
  const stealthIds = new Set(job.blocks.filter((row) => row.stealth && row.deletedAt === null).map((row) => row.uuid));
  const paths = new Map(job.blocks.map((row) => [row.uuid, row.path]));
  const team = yield* renderBlockTree(tree.filter((block) => !stealthIds.has(block.frontmatter.id)));
  const teamIds = new Set(team.paths.keys());
  const kept = tree.filter((block) => stealthIds.has(block.frontmatter.id));
  if (kept.length > 0 && job.stealth === null) {
    return yield* new ExportFailed({ message: `${kept.length} stealth block(s) need the stealth tree, and this copy serves none` });
  }
  const forest = renderForest(kept, (block) => {
    const standing = anchorOf(paths.get(block.frontmatter.id) ?? '');
    return standing !== null && standing !== block.parentId && !teamIds.has(standing) ? standing : (block.parentId as string);
  });
  const written = yield* applied(job.treeRoot, team.files);
  const forested = job.stealth === null ? { written: 0, removed: 0 } : yield* applied(job.stealth, forest.files);
  const moved = job.blocks.flatMap((row) => {
    const own = team.paths.get(row.uuid);
    const hidden = forest.paths.get(row.uuid);
    const path = own ?? (hidden === undefined ? null : `${STEALTH_PREFIX}${hidden}`);
    return path === row.path ? [] : [{ id: row.id, path }];
  });
  return { written: written.written + forested.written, removed: written.removed + forested.removed, moved };
});

const answerOf = (job: ProjectionJob): ProjectionAnswer => {
  const result = Effect.runSync(Effect.result(project(job)));
  return result._tag === 'Success'
    ? { state: 'projected', ...result.success }
    : result.failure._tag === 'ExportFailed'
      ? { state: 'failed', failure: { _tag: 'ExportFailed', message: result.failure.message } }
      : {
          state: 'failed',
          failure: {
            _tag: 'BlockTreeUnreadable',
            reason: result.failure.reason,
            path: result.failure.path,
            message: result.failure.message,
          },
        };
};

self.onmessage = (event: MessageEvent<ProjectionAsk>) => {
  const { id, job } = event.data;
  let answer: ProjectionAnswer;
  try {
    answer = answerOf(job);
  } catch (defect) {
    answer = {
      state: 'failed',
      failure: {
        _tag: 'BlockTreeUnreadable',
        reason: 'io',
        path: job.treeRoot,
        message: `the projection died: ${defect instanceof Error ? defect.message : String(defect)}`,
      },
    };
  }
  self.postMessage({ id, answer } satisfies ProjectionReply);
};
