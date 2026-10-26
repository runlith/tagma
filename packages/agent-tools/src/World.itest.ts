import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { ToolFailed } from '@runlith/agent/tool';
import { Effect } from 'effect';
import { createTools } from './index';
import { machineWorld } from './world/machine';
import { memoryFixture } from './testing/memory';
import { call, createTempDir, exists, host, options } from './testing/toolHarness';

it.effect('a files-only world serves its file tools alone, and their reads observe that filesystem', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    yield* host.writeFile(join(dir, 'host-sentinel.ts'), 'export const host = 1;\n', 'utf8');
    const { files, world } = yield* memoryFixture;
    yield* files.makeDirectory(dir, { recursive: true });
    yield* files.writeFileString(join(dir, 'guest-only.ts'), 'export const guest = 1;\n');

    const tools = createTools(options({ cwd: dir, world }));

    expect(Object.keys(tools).sort()).toEqual(['delete', 'edit', 'ls', 'read', 'rename', 'write']);
    expect(tools.bash).toBeUndefined();
    expect(tools.glob).toBeUndefined();
    expect(tools.grep).toBeUndefined();
    expect(tools.webfetch).toBeUndefined();
    expect(tools.websearch).toBeUndefined();

    const listed = yield* call(tools.ls, {});
    expect(listed).toContain('guest-only.ts');
    expect(listed).not.toContain('host-sentinel.ts');
  }),
);

it.effect('a bound filesystem takes the writes, and this machine never sees them', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    const { files, world } = yield* memoryFixture;
    yield* files.makeDirectory(dir, { recursive: true });
    const tools = createTools(options({ cwd: dir, world }));

    yield* call(tools.write, { path: join(dir, 'landed.ts'), content: 'export const landed = 1;\n' });
    expect(yield* files.readFileString(join(dir, 'landed.ts'))).toBe('export const landed = 1;\n');
    expect(yield* exists(join(dir, 'landed.ts'))).toBe(false);

    yield* call(tools.write, { path: join(dir, 'LANDED.ts'), content: 'export const other = 2;\n' });
    expect(yield* files.readFileString(join(dir, 'LANDED.ts'))).toBe('export const other = 2;\n');
    expect(yield* files.readFileString(join(dir, 'landed.ts'))).toBe('export const landed = 1;\n');
  }),
);

it.live('the shell describes the fence it enforces, and both policies answer their own way', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const outside = yield* createTempDir();
    const fenced = createTools(options({ cwd: root }));
    const open = createTools(options({ cwd: root, allowOutsideCwd: true }));

    const refused = yield* call(fenced.bash, { command: 'pwd', workdir: outside, description: 'Print the directory' });
    const ran = yield* call(open.bash, { command: 'pwd', workdir: outside, description: 'Print the directory' });

    expect(refused).toContain('Path escapes workspace root');
    expect(ran).not.toContain('Path escapes workspace root');
    expect(fenced.bash.description).not.toBe(open.bash.description);
  }),
);

it.effect('a world declaring no usable ripgrep refuses the search instead of finding one on this machine', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* host.writeFile(join(root, 'findable.txt'), 'a token worth matching\n', 'utf8');
    const world = {
      ...machineWorld,
      environment: {
        ...machineWorld.environment,
        executables: { ripgrep: Effect.fail(new ToolFailed({ reason: 'this world declares no ripgrep' })) },
      },
    };
    const tools = createTools(options({ cwd: root, world }));

    expect(yield* call(tools.glob, { pattern: '*.txt' })).toContain('this world declares no ripgrep');
    expect(yield* call(tools.grep, { pattern: 'token' })).toContain('this world declares no ripgrep');
  }),
);
