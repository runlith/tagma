import { join } from 'node:path';
import { Effect } from 'effect';
import type { HarnessCarry } from '@runlith/tagma/adapter/harness';

export const claudeCarry: HarnessCarry = {
  folder: '.claude',
  session: Effect.fnUntraced(function* (files, home, root) {
    const projects = join(home, 'projects');
    if (!(yield* files.exists(projects))) return [];
    for (const project of yield* files.readDirectory(projects)) {
      const transcript = join('projects', project, `${root}.jsonl`);
      if (!(yield* files.exists(join(home, transcript)))) continue;
      const beside = join('projects', project, root);
      return (yield* files.exists(join(home, beside))) ? [transcript, beside] : [transcript];
    }
    return [];
  }),
};
