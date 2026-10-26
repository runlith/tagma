import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { systemError } from 'effect/PlatformError';
import { machineWorld } from './world/machine';
import { ToolAnswer, ToolFailed, toolExecute, type Tool } from '@runlith/agent/tool';
import { createTools } from './index';
import { unthreadedCaller } from './testing/caller';
import { options, prepared } from './testing/toolHarness';
import { memoryFixture } from './testing/memory';

const refusal = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die(new Error('The tool declares no execute.'));
  const resolution = yield* prepared(tool, input);
  const result = yield* Effect.result(
    execute(input, { toolCallId: 'missing-path', caller: unthreadedCaller, messages: [], ...resolution }) as Effect.Effect<
      unknown,
      ToolFailed
    >,
  );
  if (result._tag === 'Failure') {
    expect(result.failure).toBeInstanceOf(ToolFailed);
    return result.failure.reason;
  }
  expect(result.success).toBeInstanceOf(ToolAnswer);
  const answer = result.success as ToolAnswer;
  expect(answer.verdict.kind).toBe('refused');
  if (answer.verdict.kind === 'refused') expect(answer.verdict.refusal.code).toBe('not-found');
  return String(answer.value);
});

function navigation(text: string) {
  const ancestor = text.match(/Nearest existing directory: (.+)/)?.[1];
  const entries = text
    .match(/<entries>\n([\s\S]*?)\n<\/entries>/)?.[1]
    ?.split('\n')
    .filter(Boolean);
  return { ancestor, entries };
}

const readers = (cwd: string, world: typeof machineWorld = machineWorld, allowOutsideCwd = false) => {
  const tools = createTools(options({ cwd, world, allowOutsideCwd }));
  return [
    { tool: tools.grep, input: { pattern: 'token' } },
    { tool: tools.glob, input: { pattern: '*.ts' } },
    { tool: tools.read, input: {} },
    { tool: tools.ls, input: {} },
  ];
};

it.effect('missing nested paths refuse with the nearest directory and its immediate entries in the caller path style', () =>
  Effect.gen(function* () {
    const { root, files, world } = yield* memoryFixture;
    const parent = join(root, 'source');
    yield* files.makeDirectory(join(parent, 'actual'), { recursive: true });
    yield* files.writeFileString(join(parent, 'actual', 'inside.ts'), 'token');
    yield* files.writeFileString(join(parent, 'note.ts'), 'token');

    for (const { tool, input } of readers(root, { ...machineWorld, files: world.files })) {
      for (const path of ['source/missing/deeper', join(parent, 'missing', 'deeper')]) {
        const text = yield* refusal(tool, { ...input, path });
        expect(navigation(text)).toEqual({
          ancestor: path.startsWith('/') ? parent : 'source',
          entries: ['actual/', 'note.ts'],
        });
      }
    }
  }),
);

it.effect('a missing file lists its existing directory with a fixed cap and an exact remainder', () =>
  Effect.gen(function* () {
    const { root, files, world } = yield* memoryFixture;
    const parent = join(root, 'source');
    yield* files.makeDirectory(parent);
    const names = Array.from({ length: 13 }, (_, index) => `file-${String(index).padStart(2, '0')}.ts`);
    for (const name of names) yield* files.writeFileString(join(parent, name), 'token');

    for (const { tool, input } of readers(root, { ...machineWorld, files: world.files })) {
      const text = yield* refusal(tool, { ...input, path: 'source/missing.ts', limit: 1 });
      expect(navigation(text)).toEqual({ ancestor: 'source', entries: [...names.slice(0, 12), '+1 more'] });
    }
  }),
);

it.effect('filesystem failures retain their category and a failed hint remains a missing-path refusal', () =>
  Effect.gen(function* () {
    const { root, files } = yield* memoryFixture;
    const directory = yield* files.stat(root);
    const denied = (method: string) =>
      Effect.fail(systemError({ _tag: 'PermissionDenied', module: 'FileSystem', method, pathOrDescriptor: root }));
    const unreadable = FileSystem.layerNoop({ stat: () => denied('stat'), readDirectory: () => denied('readDirectory') });
    const unlistable = FileSystem.layerNoop({
      stat: (path) =>
        path === root
          ? Effect.succeed(directory)
          : Effect.fail(systemError({ _tag: 'NotFound', module: 'FileSystem', method: 'stat', pathOrDescriptor: path })),
      readDirectory: (path) =>
        path === root
          ? denied('readDirectory')
          : Effect.fail(systemError({ _tag: 'NotFound', module: 'FileSystem', method: 'readDirectory', pathOrDescriptor: path })),
    });

    for (const { tool, input } of readers(root, { ...machineWorld, files: unreadable }, true)) {
      const text = yield* refusal(tool, { ...input, path: 'missing/deeper' });
      expect(text.match(/error: (\w+):/)?.[1]).toBe('PermissionDenied');
    }
    for (const { tool, input } of readers(root, { ...machineWorld, files: unlistable }, true)) {
      const text = yield* refusal(tool, { ...input, path: 'missing/deeper' });
      expect(text).toContain('missing/deeper');
      expect(text.match(/Ancestor listing unavailable: (\w+):/)?.[1]).toBe('PermissionDenied');
    }
  }),
);
