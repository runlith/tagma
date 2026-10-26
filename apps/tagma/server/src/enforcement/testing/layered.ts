import type { Inspection } from '@tagma/inspection/builtins';
import { Effect } from 'effect';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { modulesDrawn } from './wiring.js';

export const LAYERED_KEY = 'layered';

export const LAYERED = {
  builtin: 'modules',
  params: {
    base: 'src',
    tests: ['.test'],
    cycles: 'refuse',
    coverage: 'refuse',
    unresolved: 'refuse',
    reads: 'every',
    conditions: [],
    files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
  },
} satisfies Inspection;

export const layeredDrawn = Effect.fnUntraced(function* (projectId: number) {
  const under = yield* (yield* Blocks).rootBlockOf(projectId);
  return yield* modulesDrawn({
    projectId,
    caller: null,
    subjectOf: () => null,
    modules: [{ id: 'app', title: 'The app', under, root: 'src', order: [['core/'], ['ui/'], ['app/']] }],
  });
});
