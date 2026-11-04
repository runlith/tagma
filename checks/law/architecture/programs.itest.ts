import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';
import { ProgramAnswer, type ProgramInvocation, type ProgramSide } from '@tagma/inspection/program';

const RUNNER = join(import.meta.dir, '../../../apps/tagma/server/src/enforcement/programs/runner.ts');
const PROGRAM = join(import.meta.dir, '../programs.ts');
const source = 'apps/tagma/server/src';

test('the inspection runner compares each version and keeps partial coverage honest', () => {
  const root = mkdtempSync(join(tmpdir(), 'architecture-programs-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const card = (id: string, ref: string) =>
    `---\ntags: ["module"]\nfields: {"id": "${id}"}\nsources:\n  - kind: dir\n    ref: ${ref}\n---\n`;
  const run = (input: ProgramInvocation) => {
    const ran = spawnSync(process.execPath, ['--no-install', RUNNER, PROGRAM], { cwd: root, input: JSON.stringify(input) });
    if (ran.status !== 0) throw new Error(ran.stderr.toString() || `inspection runner exited ${ran.status}`);
    const answer = Schema.decodeUnknownSync(ProgramAnswer)(JSON.parse(ran.stdout.toString()));
    expect(answer.failure).toBeUndefined();
    return answer;
  };
  try {
    git('init', '-q');
    put('bun.lock', '{"lockfileVersion":1,"workspaces":{},"packages":{}}');
    put('.tagma/server.md', card('server', source));
    put('.tagma/orbit.md', card('orbit', 'packages/adapter-orbit'));
    put('packages/adapter-orbit/package.json', '{"name":"@example/orbit","exports":"./src/models.ts"}');
    put('packages/adapter-orbit/src/models.ts', "export const ORBIT_PROVIDER = 'orbit-cloud';");
    put(`${source}/providers/access.ts`, 'export class ModelAccess {}; export class Accounts {};');
    put(`${source}/translations/use.ts`, "import { Accounts } from '../providers/access.js'; export const selected = 'local';");
    put(`${source}/translations/runtime.generated.ts`, "import { Accounts } from '../providers/access.js';");
    put(`${source}/translations/future.ts`, "export const delayed = 'future-cloud';");
    put(`${source}/translations/only.fixture.ts`, "import { ModelAccess } from '../providers/access.js'; const selected = 'orbit-cloud';");
    git('add', '.');
    const base = git('write-tree');
    put(
      `${source}/translations/use.ts`,
      "import { ModelAccess as Access } from '../providers/access.js'; import { ORBIT_PROVIDER } from '@example/orbit'; export const selected = 'orbit-cloud';",
    );
    git('add', '.');
    const tree = git('write-tree');
    const changed = [`${source}/translations/use.ts`];
    let warmed = false;
    const invoke = (whole: boolean) => {
      const side = (name: ProgramSide['side']): ProgramSide => ({
        side: name,
        paths: whole ? null : changed,
        files: whole ? null : changed.map((path) => ({ path, text: git('show', `${name === 'tree' ? tree : base}:${path}`) })),
      });
      const input: ProgramInvocation = {
        request: 'architecture',
        checker: PROGRAM,
        root,
        tree,
        base,
        keys: [
          {
            key: 'vendors',
            id: 'vendor-ids',
            params: { source, include: ['**'], exclude: [] },
            reach: { places: [source], files: ['**/*.ts'] },
          },
        ],
        sides: [side('tree'), side('base')],
      };
      if (!warmed) {
        const initial: ProgramInvocation = { ...input, tree: base, base: null, sides: [{ side: 'tree', paths: null, files: null }] };
        run(initial);
        warmed = true;
      }
      const answer = run(input);
      const findings = (key: string, side: string) => answer.readings.find((one) => one.key === key && one.side === side)!;
      expect(findings('vendors', 'tree').findings.map((one) => one.path)).toEqual(changed);
      expect(findings('vendors', 'base').findings).toHaveLength(0);
      if (whole) expect(findings('vendors', 'tree').covered).toEqual({ scope: 'reach' });
      else expect(findings('vendors', 'tree').covered).toEqual(expect.arrayContaining(changed));
      return input;
    };
    invoke(false);
    const latest = invoke(true);
    put('bun.lock', '{"lockfileVersion":1,"workspaces":{"packages/new-client":{"name":"@example/new-client"}},"packages":{}}');
    put(
      'packages/adapter-orbit/src/models.ts',
      "export const ORBIT_PROVIDER = 'orbit-cloud'; export const FUTURE_PROVIDER = 'future-cloud';",
    );
    git('add', '.');
    const declared = git('write-tree');
    const vendorInput: ProgramInvocation = {
      ...latest,
      tree: declared,
      base: tree,
      keys: [latest.keys.find((one) => one.id === 'vendor-ids')!],
      sides: [
        { side: 'tree', paths: [], files: [] },
        { side: 'base', paths: [], files: [] },
      ],
    };
    const declaredAnswer = run(vendorInput);
    const vendors = declaredAnswer.readings.find((one) => one.side === 'tree')!.findings;
    expect(vendors.some((one) => one.fingerprint === `vendor:future-cloud:${source}/translations/future.ts`)).toBe(true);
    expect(declaredAnswer.readings.find((one) => one.side === 'base')!.findings.some((one) => one.path.endsWith('/future.ts'))).toBe(false);
    expect(declaredAnswer.readings.find((one) => one.side === 'tree')!.covered).toEqual(
      expect.arrayContaining([`${source}/translations/future.ts`]),
    );

    put('packages/adapter-orbit/src/models.ts', "export const ORBIT_PROVIDER = 'orbit-cloud';");
    git('add', '.');
    const undeclared = git('write-tree');
    const retired = run({ ...vendorInput, tree: undeclared, base: declared });
    const retiredBase = retired.readings.find((one) => one.side === 'base')!;
    expect(retiredBase.findings.some((one) => one.fingerprint === `vendor:future-cloud:${source}/translations/future.ts`)).toBe(true);
    expect(retiredBase.covered).toEqual(expect.arrayContaining([`${source}/translations/future.ts`]));
    expect(retired.readings.find((one) => one.side === 'tree')!.findings.some((one) => one.path.endsWith('/future.ts'))).toBe(false);

    put('bun.lock', '{"lockfileVersion":1,"workspaces":{},"packages":{"client":["client@1.0.0","",{},"sha512-client"]}}');
    git('add', '.');
    const relocked = git('write-tree');
    const lockOnly = run({ ...vendorInput, tree: relocked, base: undeclared });
    expect(lockOnly.readings.map(({ covered, findings }) => ({ covered, findings }))).toEqual([
      { covered: [], findings: [] },
      { covered: [], findings: [] },
    ]);

    const calls = {
      region: [`${source}/`],
      sources: [{ path: `${source}/providers/access.ts`, name: 'ModelAccess', capability: 'access', form: 'service' }],
      rows: [],
      allow: { request: [`${source}/providers`], ask: [], row: [] },
      aliases: [],
    };
    const key = { key: 'calls', id: 'ask-calls', params: calls, reach: { places: [''], files: ['**/*.ts'] } };
    const direct =
      "import { Effect } from 'effect'; import { ModelAccess } from '../providers/access.js'; export const run = Effect.gen(function* () { return (yield* ModelAccess).request({}); });";
    const late =
      "import { Effect } from 'effect'; import { ModelAccess } from '../providers/access.js'; export const run = Effect.gen(function* () { return (yield* ModelAccess).request({ late: true }); });";
    put(`${source}/providers/open.ts`, 'export const open = (value: number) => value;');
    put(
      `${source}/translations/caller.ts`,
      "import { open } from '../providers/open.js'; export const go = (models: unknown) => open(models as never).text({});",
    );
    put(`${source}/translations/direct.ts`, direct);
    git('add', '.');
    const first = git('write-tree');
    put(
      `${source}/providers/open.ts`,
      "import type { ModelAccess } from './access.js'; export const open = (models: ModelAccess['Service']) => models.request({});",
    );
    put('bun.lock', '{"lockfileVersion":1,"workspaces":{},"packages":{"client":["client@2.0.0","",{},"sha512-client"]}}');
    git('add', '.');
    const second = git('write-tree');
    git('rm', '-qf', `${source}/translations/direct.ts`);
    put(`${source}/translations/late.ts`, late);
    git('add', '.');
    const third = git('write-tree');
    const independent = { ...key, params: { ...calls, region: [...calls.region, 'unused/'] } };
    const attempt = (tree: string, base: string | null, changed: readonly string[] | null, asked = key) => {
      const textOf = (name: 'tree' | 'base', path: string) => {
        const shown = spawnSync('git', ['show', `${name === 'tree' ? tree : base}:${path}`], { cwd: root });
        return shown.status === 0 ? shown.stdout.toString() : null;
      };
      const sideOf = (name: ProgramSide['side']): ProgramSide => ({
        side: name,
        paths: changed,
        files:
          changed === null
            ? null
            : changed.flatMap((path) => {
                const text = textOf(name, path);
                return text === null ? [] : [{ path, text }];
              }),
      });
      const invocation: ProgramInvocation = {
        ...latest,
        tree,
        base,
        keys: [asked],
        sides: base === null ? [sideOf('tree')] : [sideOf('tree'), sideOf('base')],
      };
      return spawnSync(process.execPath, ['--no-install', RUNNER, PROGRAM], { cwd: root, input: JSON.stringify(invocation) });
    };
    const read = (tree: string, base: string | null, changed: readonly string[] | null, asked = key) => {
      const ran = attempt(tree, base, changed, asked);
      if (ran.status !== 0) throw new Error(ran.stderr.toString() || `inspection runner exited ${ran.status}`);
      const answer = Schema.decodeUnknownResult(ProgramAnswer)(JSON.parse(ran.stdout.toString()));
      if (answer._tag !== 'Success' || answer.success.failure !== undefined) throw new Error('the runner answered a failure');
      const readings = answer.success.readings;
      const one = (side: string) => readings.find((entry) => entry.side === side);
      return { tree: one('tree')!, base: one('base') };
    };
    const prints = (reading: { readonly findings: readonly { readonly fingerprint: string }[] } | undefined) =>
      reading?.findings.map((one) => one.fingerprint).sort();
    const direct1 = `ask-call:request:${source}/translations/direct.ts:ModelAccess.request`;
    const caller2 = `ask-call:request:${source}/translations/caller.ts:ModelRequest.text`;
    const late3 = `ask-call:request:${source}/translations/late.ts:ModelAccess.request`;

    const unbuilt = attempt(second, first, [`${source}/providers/open.ts`]);
    expect(unbuilt.status, unbuilt.stderr.toString()).toBe(0);
    const unprepared = Schema.decodeUnknownResult(ProgramAnswer)(JSON.parse(unbuilt.stdout.toString()));
    expect(unprepared._tag === 'Success' ? unprepared.success.unanswered?.map((one) => one.why) : unprepared).toEqual(['unprepared']);

    const built = read(first, null, null);
    expect(built.tree.covered).toEqual({ scope: 'reach' });
    expect(prints(built.tree)).toEqual([direct1]);

    const covering = (
      reading: { readonly findings: readonly { readonly fingerprint: string; readonly path: string }[] } | undefined,
      covered: unknown,
    ) => {
      if (!Array.isArray(covered)) throw new Error('a commit judgment answers explicit covered paths');
      return reading?.findings
        .filter((one) => covered.includes(one.path))
        .map((one) => one.fingerprint)
        .sort();
    };
    const moved2 = read(second, first, [`${source}/providers/open.ts`]);
    expect(moved2.tree.covered).toEqual(expect.arrayContaining([`${source}/providers/open.ts`, `${source}/translations/caller.ts`]));
    expect(moved2.tree.covered).not.toContain(`${source}/translations/direct.ts`);
    expect(prints(moved2.base)).toEqual([]);
    expect(prints(moved2.tree)).toEqual([caller2]);
    expect(prints(moved2.tree)).toEqual(covering(read(second, null, null, independent).tree, moved2.tree.covered));
    expect(prints(moved2.base)).toEqual(covering(read(first, null, null, independent).tree, moved2.base!.covered));

    const swapped = [`${source}/translations/direct.ts`, `${source}/translations/late.ts`];
    const moved3 = read(third, second, swapped);
    expect(prints(moved3.base)).toEqual([direct1]);
    expect(prints(moved3.tree)).toEqual([late3]);
    expect(prints(moved3.tree)).toEqual(covering(read(third, null, null, independent).tree, moved3.tree.covered));
    expect(prints(moved3.base)).toEqual(covering(read(second, null, null, independent).tree, moved3.base!.covered));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
