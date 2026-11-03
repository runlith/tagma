import { defineConfig } from 'vitest/config';

const isolatedUnit = ['src/ExternalLinks.test.ts', 'src/QuickHideShortcut.test.ts'];

export default defineConfig({
  test: {
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: isolatedUnit, isolate: false } },
      { extends: true, test: { name: 'unit-isolated', include: isolatedUnit, isolate: true } },
      { extends: true, test: { name: 'integration', include: ['**/*.itest.ts'], isolate: false } },
    ],
    setupFiles: ['@runlith/testbed/vitest/setup'],
    globalSetup: ['@runlith/testbed/vitest/global'],
  },
});
