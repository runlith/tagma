import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { ChangeSource, ChangedPath } from '../changeSource';

const stamps = async (root: string, at = ''): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    const name = at === '' ? entry.name : `${at}/${entry.name}`;
    if (name === '.git') continue;
    if (entry.isDirectory()) {
      found.set(name, 'directory');
      for (const [inner, stamp] of await stamps(root, name)) found.set(inner, stamp);
    } else {
      const info = await stat(join(root, name));
      found.set(name, `${info.mtimeMs}:${info.size}:${info.ino}`);
    }
  }
  return found;
};

export const walkedSource = () => {
  const marks = new Map<string, Map<string, string>>();
  let lost = false;
  let rulesMoved = 0;
  const source: ChangeSource = {
    rulesMoved: () => Effect.sync(() => void (rulesMoved += 1)),
    hold: () => Effect.succeed(() => undefined),
    settle: () => Effect.succeed(true),
    mark: (root) =>
      Effect.promise(async () => {
        const position = String(marks.size + 1);
        marks.set(position, await stamps(root));
        return position;
      }),
    changedSince: (root, position) =>
      Effect.promise(async () => {
        const before = marks.get(position);
        if (before === undefined || lost) return null;
        const now = await stamps(root);
        const changed: ChangedPath[] = [];
        for (const [name, stamp] of now) if (before.get(name) !== stamp) changed.push({ path: name, heard: null });
        for (const name of before.keys()) if (!now.has(name)) changed.push({ path: name, heard: null });
        return changed;
      }),
  };
  return { source, lose: () => (lost = true), rulesMoved: () => rulesMoved };
};
