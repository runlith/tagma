import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { THEIRS } from '../checkoutFixture.js';
import { refusalOf } from '../graphFixture.js';
import { programFixture, withProgram } from '../programFixture.js';

layer(programFixture(), { excludeTestServices: true })('program sources', (it) => {
  it.effect("a peer's unfinished edit to a workspace package the program imports does not fail another session's landing", () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        yield* gate.put('.gitignore', 'node_modules\n');
        yield* gate.put('packages/words/package.json', '{ "name": "words", "type": "module", "exports": { ".": "./index.js" } }\n');
        yield* gate.put('packages/words/list.cjs', "module.exports = { word: 'FORBIDDEN' };\n");
        yield* gate.put('packages/words/index.js', "import list from './list.cjs';\nexport const WORD = list.word;\n");
        yield* files.makeDirectory(join(gate.current().demoRoot, 'node_modules'), { recursive: true });
        yield* files.symlink('../packages/words', join(gate.current().demoRoot, 'node_modules/words'));
        yield* gate.put(
          'tools/check.js',
          `import { WORD } from 'words';
const found = async (side) => (await Promise.all(side.paths.map(async (path) => {
  const text = (await side.read(path)) ?? '';
  return text.includes(WORD) ? [{ fingerprint: path + ' × ' + WORD, path, line: 1, message: 'forbidden' }] : [];
}))).flat();
export default { forbidden: async ({ tree, base }) => ({ tree: { findings: await found(tree) }, base: base === null ? undefined : { findings: await found(base) } }) };`,
        );
        yield* gate.committed('the program reads its word from a workspace package');
        yield* gate.enforcedAt('gate', {});
        yield* gate.wroteAs(THEIRS, 'packages/words/list.cjs', "module.exports = { renamed: 'FORBIDDEN' };\n");
        yield* gate.wroteAs(THEIRS, 'packages/words/index.js', "import list from './list.cjs';\nexport const RENAMED = list.renamed;\n");
        yield* gate.wrote('src/b.ts', 'export const b = 2; // FORBIDDEN\n');
        const refused = yield* refusalOf(gate.landing(['src/b.ts']));
        expect(refused.code).toBe('rule-violated');
        expect(refused.reason).toContain('src/b.ts:1');
      }),
    ),
  );
});
