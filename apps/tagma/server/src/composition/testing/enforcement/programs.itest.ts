import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { MINE } from '../checkoutFixture.js';
import { refusalOf } from '../graphFixture.js';
import { fp, programFixture, withProgram } from '../programFixture.js';

layer(programFixture(), { excludeTestServices: true })('program judgement', (it) => {
  it.effect('a grouped program finding names every site at the gate and in check_rules over the same change', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        yield* gate.put(
          'tools/check.js',
          `
const found = async (side) => (await Promise.all(side.paths.map(async (path) => {
  const text = (await side.read(path)) ?? '';
  const sites = text.split('\\n').flatMap((line, at) => line.includes('FORBIDDEN') ? [{ line: at + 1, specifier: 'FORBIDDEN' }] : []);
  return sites.length === 0 ? [] : [{ fingerprint: path + ' × FORBIDDEN', path, line: sites[0].line, sites, message: 'forbidden' }];
}))).flat();
export default {
  forbidden: async ({ tree, base }) => ({
    tree: { covered: 'reach', findings: await found(tree) },
    base: base === null ? undefined : { covered: 'reach', findings: await found(base) },
  }),
};`,
        );
        yield* gate.committed('a program that groups the sites of one fingerprint');
        yield* gate.enforcedAt('gate', {});
        const base = yield* gate.revision('HEAD');
        const text = 'export const b = 2; // FORBIDDEN two\nexport const c = 3; // FORBIDDEN two\n';
        yield* gate.wrote('src/b.ts', text);
        gate.launches.length = 0;
        const refused = yield* refusalOf(gate.landing());
        expect(refused.code).toBe('rule-violated');
        expect(refused.reason).toContain('src/b.ts:1');
        expect(refused.reason).toContain('src/b.ts:2');
        expect(gate.launches.map((one) => one.actor)).toEqual([
          { _tag: 'Thread', threadId: ThreadId.make(MINE), projectId: gate.current().projectId },
        ]);
        expect(gate.inputOf(gate.launches[0])).toMatchObject({
          root: gate.current().demoRoot,
          base,
          keys: [{ id: 'forbidden', params: {}, reach: { places: [''] } }],
        });
        expect(gate.inputOf(gate.launches[0]).sides[0]).toEqual({
          side: 'tree',
          paths: ['src/b.ts'],
          files: [{ path: 'src/b.ts', text }],
        });
        const checked = yield* gate.checkedChange();
        expect(checked?.refuses).toBe(true);
        expect(checked?.violations.map(({ fingerprint, file, line, specifier }) => ({ fingerprint, file, line, specifier }))).toEqual([
          { fingerprint: fp('src/b.ts × FORBIDDEN'), file: 'src/b.ts', line: 1, specifier: 'FORBIDDEN' },
          { fingerprint: fp('src/b.ts × FORBIDDEN'), file: 'src/b.ts', line: 2, specifier: 'FORBIDDEN' },
        ]);
      }),
    ),
  );
  it.effect('a change carrying a binary asset still judges its source and lands the unread asset byte for byte', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const asset = 'native/sqlite.zip';
        yield* files.makeDirectory(join(gate.current().demoRoot, 'native'));
        yield* files.writeFile(join(gate.current().demoRoot, asset), new Uint8Array([0x50, 0x4b, 0xfe, 0xff]));
        yield* gate.committed('seed tracked binary asset');
        yield* gate.enforcedAt('gate');
        const bytes = new Uint8Array([0x50, 0x4b, 0xff, 0xfe, 0x00]);
        yield* files.writeFile(join(gate.current().demoRoot, asset), bytes);
        const paths = [asset, 'src/b.ts'];
        yield* gate.wrote('src/b.ts', 'export const b = 2; // FORBIDDEN two\n');
        const refused = yield* refusalOf(gate.landing(paths));
        expect(refused.code).toBe('rule-violated');
        expect(refused.reason).toContain('src/b.ts:1');
        yield* gate.wrote('src/b.ts', 'export const b = 2;\n');
        expect((yield* gate.landing(paths)).status).toBe('landed');
        expect(yield* gate.revision(`HEAD:${asset}`)).toBe(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'));
      }),
    ),
  );
  it.effect('a violation both sides of a landing carry is not new, so the landing is let through', () =>
    withProgram((gate) =>
      Effect.gen(function* () {
        yield* gate.enforcedAt('gate');
        yield* gate.put('src/c.ts', 'export const c = 3; // FORBIDDEN three\n');
        yield* gate.committed('a violation that got in outside Tagma');
        yield* gate.wrote('src/c.ts', 'export const c = 3; // FORBIDDEN three\nexport const d = c;\n');
        expect((yield* gate.landing()).status).toBe('landed');
      }),
    ),
  );
});
