import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { THEIRS } from '../checkoutFixture.js';
import { refusalOf } from '../graphFixture.js';
import { BOUND, programFixture, withProgram } from '../programFixture.js';
import { REPO_ROOT } from '../repoRoot.js';

layer(programFixture(), { excludeTestServices: true })('linter configs', (it) => {
  for (const [tool, config, before, broken] of [
    [
      'oxlint',
      'checks/law.json',
      JSON.stringify({ plugins: [], categories: { correctness: 'off' }, rules: {} }),
      '{ "rules": { half written',
    ],
    ['eslint', 'checks/law.config.js', 'export default [{ files: ["**/*.ts"] }];\n', "throw new Error('half written');\n"],
  ] as const) {
    it.effect(`a peer's unfinished edit to the ${tool} config does not judge another session's landing`, () =>
      withProgram((gate) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const root = gate.current().demoRoot;
          yield* gate.put('.gitignore', 'node_modules\n');
          yield* gate.put(config, before);
          yield* files.makeDirectory(join(root, 'node_modules'), { recursive: true });
          yield* files.symlink(join(REPO_ROOT, 'node_modules', tool), join(root, 'node_modules', tool));
          yield* gate.committed(`the ${tool} config`);
          gate.current().described.set(BOUND, { linter: { tool, config }, rule: tool === 'oxlint' ? 'eslint/no-debugger' : 'no-debugger' });
          yield* gate.enforcedAt('gate', {});
          yield* gate.wroteAs(THEIRS, config, broken);
          yield* gate.wrote('src/b.ts', 'export const b = 2;\ndebugger;\n');
          const refused = yield* refusalOf(gate.landing(['src/b.ts']));
          expect(refused.code).toBe('rule-violated');
          expect(refused.reason).toContain('src/b.ts');
        }),
      ),
    );
  }
});
