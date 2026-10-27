import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { flushDirectoriesSync, isStaging, stagingOf, writeAtomicSync } from './atomicFile.js';
import { exportGraphRows, groupConnections } from './export.js';
import { BlockTreeUnreadable, renderBlockTree } from './layout.js';
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

const project = Effect.fnUntraced(function* (job: ProjectionJob) {
  const tree = yield* exportGraphRows(job.blocks, groupConnections(job.connections));
  const rendered = yield* renderBlockTree(tree);
  const applied = yield* Effect.try({
    try: () => applyTreeFiles(job.treeRoot, rendered.files),
    catch: (error) =>
      new BlockTreeUnreadable({ reason: 'io', path: job.treeRoot, message: error instanceof Error ? error.message : String(error) }),
  });
  const moved = job.blocks.flatMap((row) => {
    const path = rendered.paths.get(row.uuid) ?? null;
    return path === row.path ? [] : [{ id: row.id, path }];
  });
  return { ...applied, moved };
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
