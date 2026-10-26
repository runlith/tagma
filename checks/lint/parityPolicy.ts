import type { Options } from './catalogTags';

export const parityPolicy: Options = {
  base: 'apps/tagma/server/src',
  files: { extensions: ['.ts', '.tsx'], exclude: ['**/*.test.ts', '**/*.itest.ts', '**/*.stest.ts', '**/*.d.ts'] },
  uncovered: [],
  literals: [
    {
      region: ['graph/**'],
      words: ['module', 'area', 'claim', 'decision', 'task', 'rule', 'idea', 'research', 'view', 'proposal', 'reflection'],
      positions: ['compare', 'argument', 'property', 'lookup'],
      allowIn: [],
    },
  ],
};
