import { astGrepRunner } from './ast-grep.js';
import { findingsCommandRunner, sarifCommandRunner } from './command.js';
import { eslintRunner } from './eslint.js';
import type { FilesRunner } from './filesRunner.js';
import { oxlintAnswer } from './oxlint.js';
import { ruffRunner } from './ruff.js';
import { semgrepRunner } from './semgrep.js';

const oxlint: FilesRunner = {
  id: 'oxlint',
  answer: (road, launch) => oxlintAnswer(road, { ...launch, inReach: (path) => launch.input.keys.some((key) => launch.covers(key, path)) }),
};
const runners = new Map(
  [oxlint, eslintRunner, ruffRunner, astGrepRunner, semgrepRunner, sarifCommandRunner, findingsCommandRunner].map((runner) => [
    runner.id,
    runner,
  ]),
);
export const adapterIn = (id: string): FilesRunner | undefined => runners.get(id);
