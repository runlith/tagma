import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { THREAD_TOOL_CONFIRM_VALUE } from '@runlith/agent/transcript/parts';
import { Context, Data, Effect, FileSystem, Layer, Queue, Schedule, Stream } from 'effect';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { installedFixture } from '../plugin-host/installed.js';

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
  const subject = path === '' ? String(event.tool_input?.command ?? '') : path.split('/').pop();
  const additionalContext = event.tool_name + ' of ' + subject + ' noted';
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
}
`;

const guarded = `"${process.execPath}" "\${CLAUDE_PLUGIN_ROOT}/hooks/guard.ts"`;

const PLUGIN: Readonly<Record<string, string>> = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'guard' }),
  'hooks/guard.ts': GUARD,
  'hooks/hooks.json': JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: guarded }] }],
      PostToolUse: [{ matcher: 'Read|Write|Bash', hooks: [{ type: 'command', command: guarded }] }],
    },
  }),
};

const CODEX_GUARD = `
const event = JSON.parse(await Bun.stdin.text());
if (event.hook_event_name === 'PreToolUse' && String(event.tool_input?.command ?? '').includes('codex-deny')) {
  const data = process.env.PLUGIN_DATA ? 'set' : 'unset';
  const root = process.env.CLAUDE_PLUGIN_ROOT === process.env.PLUGIN_ROOT ? 'agreeing' : 'differing';
  console.error('codex hook saw ' + event.tool_name + ' with data ' + data + ' and root ' + root);
  process.exit(2);
}
`;

const CODEX_PLUGIN: Readonly<Record<string, string>> = {
  '.codex-plugin/plugin.json': JSON.stringify({ name: 'codex-guard' }),
  'hooks/codex-guard.ts': CODEX_GUARD,
  'hooks/hooks.json': JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: `"${process.execPath}" "\${PLUGIN_ROOT}/hooks/codex-guard.ts"` }] },
      ],
    },
  }),
};

const calls = (...made: readonly (readonly [id: string, name: string, input: unknown])[]): readonly LLMEvent[] => [
  { type: 'step-start', index: 0 },
  ...made.flatMap(([id, name, input]): LLMEvent[] => [
    { type: 'tool-input-start', id, name },
    { type: 'tool-call', id, name, input },
  ]),
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls' },
];

const call = (id: string, name: string, input: unknown): readonly LLMEvent[] => calls([id, name, input]);

const DONE: readonly LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text: 'Done.' },
  { type: 'text-end', id: 'reply' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop' },
];

class AwaitedStateNever extends Data.TaggedError('AwaitedStateNever')<{}> {}

const TITLE = 'name the subject the user is working on';
type Script = { readonly asked: string[]; readonly answer: (answered: number, said: string) => readonly LLMEvent[] };
const scripts = new Map<string, Script>();
let checkout = '';

const answeredIn = (said: string): number => said.split('"role":"tool"').length - 1;

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
              const script = said.includes(TITLE) ? undefined : [...scripts].find(([words]) => said.includes(words))?.[1];
              if (script === undefined) return request.stream(streamed);
              script.asked.push(said);
              return Stream.fromIterable(script.answer(answeredIn(said), said));
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
  const scope = `project=${projectId}`;
  for (const [name, id, plugin] of [
    ['guard-plugin', 'guard', PLUGIN],
    ['codex-guard-plugin', 'codex-guard', CODEX_PLUGIN],
  ] as const) {
    const directory = yield* world.directory(name);
    for (const [path, text] of Object.entries(plugin)) {
      yield* files.makeDirectory(join(directory, path, '..'), { recursive: true });
      yield* files.writeFileString(join(directory, path), text);
    }
    const installed = yield* world.op('install_plugin', { source: directory }, scope);
    expect(installed.body).toMatchObject({ plugin: { id, enabled: true } });
    yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id }, scope).pipe(Effect.orDie));
  }
  return { world, account, projectId, scope };
});

class Guarded extends Context.Service<Guarded, Effect.Success<typeof setup>>()('testing/GuardedPlugin') {}

const scripted = (words: string, answer: Script['answer']): Script => {
  const script = { asked: [], answer };
  scripts.set(words, script);
  return script;
};

const born = Effect.fnUntraced(function* (approvalMode: 'bypass' | 'review') {
  const { world, account, projectId } = yield* Guarded;
  const { thread } = yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account, approvalMode });
  const settled = yield* Queue.unbounded<string>();
  yield* Context.get(world.runtime.owners, ThreadHarness)
    .runs.settlements()
    .subscribe({
      name: `plugin hooks ${thread.id}`,
      at: 'after-stages',
      handle: (event) => (event.threadId === thread.id ? Queue.offer(settled, event.runId).pipe(Effect.asVoid) : Effect.void),
    });
  const ended = (runId: string) =>
    Stream.runDrain(
      Stream.take(
        Stream.filter(Stream.fromQueue(settled), (id) => id === runId),
        1,
      ),
    );
  return { threadId: thread.id, ended };
});

const turn = Effect.fnUntraced(function* (threadId: string, text: string) {
  const { world, scope } = yield* Guarded;
  const started = yield* world.op('start_turn', { threadId, text, key: crypto.randomUUID() }, scope);
  return (started.body as { runId: string }).runId;
});

const KEEPS_READS = [{ at: 'beforeTool', match: 'read', tool: 'hook' }] as const;

const keeper = Effect.fnUntraced(function* (id: string, hooks: readonly Readonly<Record<string, unknown>>[], mark: string | null) {
  const { world, projectId } = yield* Guarded;
  const data = join(world.dataHome, 'agent-plugin-data', id);
  if (mark !== null) yield* Effect.promise(() => mkdir(data, { recursive: true }).then(() => writeFile(join(data, mark), '')));
  yield* installedFixture(world, projectId, { id, contributes: { hooks } });
  return join(data, 'journal');
});

const until = <A, E, R>(found: Effect.Effect<A | undefined, E, R>) =>
  Effect.retry(
    Effect.flatMap(found, (value) => (value === undefined ? Effect.fail(new AwaitedStateNever()) : Effect.succeed(value))),
    { schedule: Schedule.spaced('20 millis'), while: (failure) => failure instanceof AwaitedStateNever },
  );

layer(Layer.effect(Guarded, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('plugin hooks', (it) => {
  it.effect(
    'a PreToolUse hook blocks one read with the reason the model reads, rewrites another, and a PostToolUse hook adds context',
    () =>
      Effect.gen(function* () {
        const script = scripted('Read the files.', (answered) =>
          answered === 0
            ? call('call-secret', 'read', { path: join(checkout, 'secret.txt') })
            : answered === 1
              ? call('call-draft', 'read', { path: join(checkout, 'draft.txt') })
              : DONE,
        );
        const { threadId, ended } = yield* born('bypass');
        yield* ended(yield* turn(threadId, 'Read the files.'));

        const last = script.asked.at(-1) ?? '';
        expect(last).toContain('read is refused: secrets stay closed');
        expect(last).not.toContain('secret words');
        expect(last).toContain('final words');
        expect(last).not.toContain('draft words');
        expect(last).toContain('Read of final.txt noted');
      }),
  );

  it.effect(
    'a beforeTool hook a Tagma-format plugin declares wakes its sleeping process and denies the matching call with its reason',
    () =>
      Effect.gen(function* () {
        const journal = yield* keeper('keeper', KEEPS_READS, null);
        expect(existsSync(journal)).toBe(false);
        const script = scripted('Read the kept file.', (answered) =>
          answered === 0 ? call('call-kept', 'read', { path: join(checkout, 'final.txt') }) : DONE,
        );
        const { threadId, ended } = yield* born('bypass');
        yield* ended(yield* turn(threadId, 'Read the kept file.'));

        expect(script.asked.at(-1)).toContain('read is refused: kept by the fixture: read');
        expect(script.asked.at(-1)).not.toContain('final words');
        const lines = (yield* Effect.promise(() => readFile(journal, 'utf8'))).trim().split('\n');
        expect(lines[0]).toStartWith('start ');
        const asked = lines.find((line) => line.startsWith('hook tagma '))?.slice('hook tagma '.length) ?? 'null';
        expect(JSON.parse(asked)).toMatchObject({ at: 'beforeTool', threadId, tool: 'read', callId: 'call-kept' });
      }),
  );

  it.effect('a Tagma-format hook that fails lets the call through, unless it declares that it blocks on failure', () =>
    Effect.gen(function* () {
      yield* keeper('porter', KEEPS_READS, 'fail-hook');
      const open = scripted('Read past the porter.', (answered) =>
        answered === 0 ? call('call-porter', 'read', { path: join(checkout, 'final.txt') }) : DONE,
      );
      const first = yield* born('bypass');
      yield* first.ended(yield* turn(first.threadId, 'Read past the porter.'));
      expect(open.asked.at(-1)).toContain('final words');

      yield* keeper('warden', [{ ...KEEPS_READS[0], onFailure: 'block' }], 'fail-hook');
      const closed = scripted('Read past the warden.', (answered) =>
        answered === 0 ? call('call-warden', 'read', { path: join(checkout, 'final.txt') }) : DONE,
      );
      const second = yield* born('bypass');
      yield* second.ended(yield* turn(second.threadId, 'Read past the warden.'));
      expect(closed.asked.at(-1)).toContain('read is refused: a hook that blocks on failure failed: the keeper is down');
      expect(closed.asked.at(-1)).not.toContain('final words');
    }),
  );

  it.effect('a Tagma-format hook that blocks on failure denies the call when its tool answers no hook answer', () =>
    Effect.gen(function* () {
      yield* keeper('mute', [{ ...KEEPS_READS[0], onFailure: 'block' }], 'plain-hook');
      const script = scripted('Read past the mute keeper.', (answered) =>
        answered === 0 ? call('call-mute', 'read', { path: join(checkout, 'final.txt') }) : DONE,
      );
      const { threadId, ended } = yield* born('bypass');
      yield* ended(yield* turn(threadId, 'Read past the mute keeper.'));
      expect(script.asked.at(-1)).toContain('read is refused: a hook that blocks on failure failed: answered no hook answer');
      expect(script.asked.at(-1)).not.toContain('final words');
    }),
  );

  it.effect('a Codex PreToolUse hook sees Codex tool names and environment and blocks a shell call through the shared runner', () =>
    Effect.gen(function* () {
      const script = scripted('Run the denied shell.', (answered) =>
        answered === 0 ? call('call-codex', 'bash', { command: 'echo codex-deny' }) : DONE,
      );
      const { threadId, ended } = yield* born('bypass');
      yield* ended(yield* turn(threadId, 'Run the denied shell.'));

      expect(script.asked.at(-1)).toContain('bash is refused: codex hook saw Bash with data set and root agreeing');
    }),
  );

  it.effect('a PostToolUse context reaches the run resumed after the call it follows was approved', () =>
    Effect.gen(function* () {
      const { world } = yield* Guarded;
      const script = scripted('Write the note.', (answered) =>
        answered === 0 ? call('call-note', 'write', { path: join(checkout, 'note.txt'), content: 'noted\n' }) : DONE,
      );
      const { threadId, ended } = yield* born('review');
      yield* turn(threadId, 'Write the note.');
      const questions = Context.get(world.runtime.owners, ThreadHarness).runs.questions();
      const question = yield* until(Effect.map(questions.open(threadId), (open) => open[0]));
      const answered = yield* questions.answer(
        threadId,
        question.questionId,
        question.questions.map((asked) => ({ questionId: asked.id, values: [THREAD_TOOL_CONFIRM_VALUE] })),
      );
      if (answered === null) return yield* Effect.die(new Error('the answer opened no run'));
      yield* ended(answered.runId);

      expect(script.asked.at(-1)).toContain('Write of note.txt noted');
    }),
  );

  it.effect('a PostToolUse context reaches the run that reads the ending of a call that ran in the background', () =>
    Effect.gen(function* () {
      const script = scripted('Read in the background.', (answered) =>
        answered === 0 ? call('call-behind', 'read', { path: join(checkout, 'final.txt'), background: true }) : DONE,
      );
      const { threadId, ended } = yield* born('bypass');
      yield* ended(yield* turn(threadId, 'Read in the background.'));
      const told = yield* until(Effect.sync(() => script.asked.find((said) => said.includes('read finished in the background'))));

      expect(told).toContain('Read of final.txt noted');
    }),
  );

  it.effect('a capability cue told with the ending of a background call is not told again on the next matching call', () => {
    const navigation = Effect.fnUntraced(function* (value: boolean) {
      const { world, projectId } = yield* Guarded;
      return yield* world.op('write_setting', { project: projectId, key: 'navigation.enabled', value });
    });
    return Effect.gen(function* () {
      yield* navigation(true);
      const pattern = String.raw`\.draft\(`;
      const script = scripted('Grep twice.', (_, said) =>
        said.includes('call-late')
          ? DONE
          : said.includes('grep finished in the background')
            ? call('call-late', 'grep', { pattern, path: checkout })
            : said.includes('call-early')
              ? DONE
              : call('call-early', 'grep', { pattern, path: checkout, background: true }),
      );
      const { threadId } = yield* born('bypass');
      yield* turn(threadId, 'Grep twice.');
      const last = yield* until(Effect.sync(() => script.asked.find((said) => said.includes('call-late'))));

      expect(last.split('"capability-cues:navigation":true').length - 1).toBe(1);
    }).pipe(Effect.ensuring(Effect.orDie(navigation(false))));
  });

  it.effect('a PostToolUse context reaches the thread when the call it follows is handed to the background as a command', () =>
    Effect.gen(function* () {
      const { world, scope } = yield* Guarded;
      const command = 'until [ -f released ]; do sleep 0.1; done';
      const script = scripted('Run the slow shell.', (_, said) =>
        said.includes('call-shell') ? DONE : call('call-shell', 'bash', { command, waitMs: 60_000 }),
      );
      const { threadId } = yield* born('bypass');
      const runId = yield* turn(threadId, 'Run the slow shell.');
      yield* until(
        Effect.map(
          Effect.suspend(() => world.op('control_call', { runId, toolCallId: 'call-shell', control: { action: 'background' } }, scope)),
          (answer) => ((answer.body as { control?: string } | null)?.control === 'changed' ? true : undefined),
        ),
      );
      const told = yield* until(Effect.sync(() => script.asked.find((said) => said.includes(`Bash of ${command} noted`))));
      const [, execution, incarnation] = /Moved ([\w-]+):(\d+) to the background/.exec(told) ?? [];
      const stopped = yield* world.op(
        'stop_command',
        { operationId: crypto.randomUUID(), execution, incarnation: Number(incarnation), cause: 'explicit-stop' },
        scope,
      );

      expect(told).toContain('bash finished in the background');
      expect(stopped.status).toBe(200);
    }),
  );

  it.effect('a PostToolUse context of a call answered beside a parked one reaches the run resumed after the approval', () =>
    Effect.gen(function* () {
      const { world } = yield* Guarded;
      const script = scripted('Read and write.', (answered) =>
        answered === 0
          ? calls(
              ['call-beside', 'read', { path: join(checkout, 'final.txt') }],
              ['call-parked', 'write', { path: join(checkout, 'beside.txt'), content: 'beside\n' }],
            )
          : DONE,
      );
      const { threadId, ended } = yield* born('review');
      yield* turn(threadId, 'Read and write.');
      const questions = Context.get(world.runtime.owners, ThreadHarness).runs.questions();
      const question = yield* until(Effect.map(questions.open(threadId), (open) => open[0]));
      const answered = yield* questions.answer(
        threadId,
        question.questionId,
        question.questions.map((asked) => ({ questionId: asked.id, values: [THREAD_TOOL_CONFIRM_VALUE] })),
      );
      if (answered === null) return yield* Effect.die(new Error('the answer opened no run'));
      yield* ended(answered.runId);

      expect(script.asked.at(-1)).toContain('Read of final.txt noted');
      expect(script.asked.at(-1)).toContain('Write of beside.txt noted');
    }),
  );
});
