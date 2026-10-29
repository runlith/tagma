import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { Context, Effect, FileSystem, Layer, Queue, Stream } from 'effect';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';

const GUARD = `
const event = JSON.parse(await Bun.stdin.text());
const path = String(event.tool_input?.file_path ?? '');
if (event.hook_event_name === 'PreToolUse' && path.endsWith('secret.txt')) {
  console.error('secrets stay closed');
  process.exit(2);
}
if (event.hook_event_name === 'PreToolUse' && path.endsWith('draft.txt')) {
  const updatedInput = { file_path: path.replace('draft.txt', 'final.txt') };
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } }));
}
if (event.hook_event_name === 'PostToolUse') {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'read noted' } }));
}
`;

const guarded = `"${process.execPath}" "\${CLAUDE_PLUGIN_ROOT}/hooks/guard.ts"`;

const PLUGIN: Readonly<Record<string, string>> = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'guard' }),
  'hooks/guard.ts': GUARD,
  'hooks/hooks.json': JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: guarded }] }],
      PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: guarded }] }],
    },
  }),
};

const call = (id: string, path: string): readonly LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id, name: 'read' },
  { type: 'tool-call', id, name: 'read', input: { path } },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls' },
];

const DONE: readonly LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text: 'Done.' },
  { type: 'text-end', id: 'reply' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop' },
];

const TITLE = 'name the subject the user is working on';
const asked: string[] = [];
let checkout = '';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({
    models: (standing) => ({
      ...standing,
      request: (input) => {
        const { web: _, ...request } = standing.request(input);
        return {
          ...request,
          stream: (streamed) =>
            Stream.suspend(() => {
              const said = JSON.stringify(streamed.messages);
              if (!said.includes('Read the files.') || said.includes(TITLE)) return request.stream(streamed);
              asked.push(said);
              const answered = said.split('"role":"tool"').length - 1;
              return Stream.fromIterable(
                answered === 0
                  ? call('call-secret', join(checkout, 'secret.txt'))
                  : answered === 1
                    ? call('call-draft', join(checkout, 'draft.txt'))
                    : DONE,
              );
            }),
        };
      },
    }),
  });
  const files = yield* FileSystem.FileSystem;
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  checkout = yield* world.directory('guarded');
  const projectId = yield* world.stealthProject(checkout);
  yield* projectLeaving(world, projectId);
  yield* files.writeFileString(join(checkout, 'secret.txt'), 'secret words\n');
  yield* files.writeFileString(join(checkout, 'draft.txt'), 'draft words\n');
  yield* files.writeFileString(join(checkout, 'final.txt'), 'final words\n');
  const plugin = yield* world.directory('guard-plugin');
  for (const [path, text] of Object.entries(PLUGIN)) {
    yield* files.makeDirectory(join(plugin, path, '..'), { recursive: true });
    yield* files.writeFileString(join(plugin, path), text);
  }
  const scope = `project=${projectId}`;
  const installed = yield* world.op('install_plugin', { source: plugin }, scope);
  expect(installed.body).toMatchObject({ plugin: { id: 'guard', enabled: true } });
  yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id: 'guard' }, scope).pipe(Effect.orDie));
  return { world, account, projectId, scope };
});

class Guarded extends Context.Service<Guarded, Effect.Success<typeof setup>>()('testing/GuardedPlugin') {}

layer(Layer.effect(Guarded, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('plugin hooks', (it) => {
  it.effect(
    'a PreToolUse hook blocks one read with the reason the model reads, rewrites another, and a PostToolUse hook adds context',
    () =>
      Effect.gen(function* () {
        const { world, account, projectId, scope } = yield* Guarded;
        const harness = Context.get(world.runtime.owners, ThreadHarness);
        const { thread } = yield* birthsOf(world.runtime.owners).create({
          projectId,
          createdBySessionId: null,
          account,
          approvalMode: 'bypass',
        });
        const ended = yield* Queue.unbounded<string>();
        yield* harness.runs.settlements().subscribe({
          name: 'plugin hooks turn',
          at: 'after-stages',
          handle: (event) => (event.threadId === thread.id ? Queue.offer(ended, event.runId).pipe(Effect.asVoid) : Effect.void),
        });
        const started = yield* world.op('start_turn', { threadId: thread.id, text: 'Read the files.', key: crypto.randomUUID() }, scope);
        const runId = (started.body as { runId: string }).runId;
        yield* Stream.runDrain(
          Stream.take(
            Stream.filter(Stream.fromQueue(ended), (id) => id === runId),
            1,
          ),
        );

        const last = asked.at(-1) ?? '';
        expect(last).toContain('read is refused: secrets stay closed');
        expect(last).not.toContain('secret words');
        expect(last).toContain('final words');
        expect(last).not.toContain('draft words');
        expect(last).toContain('read noted');
      }),
  );
});
