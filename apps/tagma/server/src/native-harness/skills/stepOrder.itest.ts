import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, FileSystem, Stream } from 'effect';
import { Agent } from '@runlith/agent/Agent';
import { makeAgentRunner } from '@runlith/agent/AgentRunner';
import { RunStop } from '@runlith/agent/RunStop';
import type { ModelRequest } from '@runlith/agent/modelPort';
import { modeOfLookup } from '@runlith/agent/modes/ApprovalMode';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { versionedShelf } from '../../artifacts/testing/doubles.js';
import { artifactSkill } from './artifacts.js';
import { checkoutWorld, makeMachineWorld } from '../../executions/testing/doubles.js';

const USAGE = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});

const oneStep = (calls: readonly { readonly id: string; readonly name: string; readonly input: unknown }[]): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  ...calls.flatMap(({ id, name, input }): LLMEvent[] => [
    { type: 'tool-input-start', id, name },
    { type: 'tool-call', id, name, input },
  ]),
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage: USAGE },
];

const answered: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', text: 'Done.' },
  { type: 'text-end', id: 'text-1' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage: USAGE },
];

const scripted = (turns: LLMEvent[][], asked: (readonly Message[])[]): ModelRequest => ({
  plannedOutputTokens: 32,
  origin: new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('gpt-5.5') }),
  text: () => {
    throw new Error('the step opens streamed requests only');
  },
  object: () => {
    throw new Error('the step opens streamed requests only');
  },
  stream: (input) =>
    Stream.suspend(() => {
      asked.push(input.messages);
      return Stream.fromIterable(turns.shift() ?? answered);
    }),
});

const resultOf = (messages: readonly Message[], id: string): string =>
  JSON.stringify(messages.flatMap((message) => message.content.filter((part) => part.type === 'tool-result' && part.id === id)));

layer(BunFileSystem.layer, { excludeTestServices: true })('calls of one model step', (it) => {
  it.effect('dependent real calls of one step see what the calls before them wrote, whatever order they would race in', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'step-order-' });
        const page = join(root, 'page.html');
        const draft = join(root, 'draft.html');
        writeFileSync(page, '<!doctype html><title>Old</title><body>old page');
        writeFileSync(draft, `<!doctype html><title>New</title><body>new page${'<p>long page</p>'.repeat(400_000)}`);
        writeFileSync(join(root, 'notes.txt'), 'before the edit\n');
        const store = yield* versionedShelf(join(root, 'shelf'), 'http://localhost');
        const earlier = (yield* store.publish({ path: page, thread: 'thread-1' })).record;
        const machine = makeMachineWorld(() => null);
        const world = checkoutWorld({ projectRoot: root, scratch: join(root, 'scratch'), world: machine });
        const tools = {
          ...createTools({ cwd: root, world: machine, commandTimes: unruledTimes, searchMs: LONGEST_ACT_MS }),
          ...artifactSkill(store).tools!({ thread: { id: 'thread-1' }, world }),
        };
        const agent = new Agent({
          id: 'tagma',
          name: 'StepOrder',
          description: 'Runs what one step asks.',
          instructions: () => 'Run the calls.',
          tools: () => tools,
          stopWhen: [],
        });
        const asked: (readonly Message[])[] = [];
        const model = scripted(
          [
            oneStep([
              { id: 'write-page', name: 'write', input: { path: 'page.html', fromFile: 'draft.html' } },
              { id: 'publish-page', name: 'publish_artifact', input: { path: page } },
              { id: 'edit-notes', name: 'edit', input: { path: 'notes.txt', oldString: 'before', newString: 'after' } },
              { id: 'cat-notes', name: 'bash', input: { command: 'cat notes.txt' } },
              { id: 'write-source', name: 'write', input: { path: 'source.txt', content: 'fresh source\n' } },
              { id: 'copy-source', name: 'write', input: { path: 'copy.txt', fromFile: 'source.txt' } },
            ]),
          ],
          asked,
        );
        const runner = yield* makeAgentRunner({ models: { request: () => model }, idleMs: 5_000 });
        const run = yield* runner.run(
          agent,
          {
            runId: 'run-1',
            stop: new RunStop(),
            caller: { agentId: 'tagma', ownerId: 'owner', thread: { threadId: 'thread-1', runId: 'run-1', bindings: {} } },
            ctx: {},
            model: { ownerId: 'owner', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: null, switches: {} },
            messages: [Message.user('Write, publish, edit and read in one step.')],
            approval: { mode: 'trust', interactive: false },
            modeOf: modeOfLookup(builtinModeRegistry(), 'trust'),
          },
          { push: () => Effect.void },
        );
        expect(yield* run.output.text).toBe('Done.');
        const results = asked[1] ?? [];
        expect((yield* store.page(earlier.id))?.html).toBe(readFileSync(draft, 'utf8'));
        expect(resultOf(results, 'cat-notes')).toContain('after the edit');
        expect(readFileSync(join(root, 'copy.txt'), 'utf8')).toBe('fresh source\n');
        expect(resultOf(results, 'copy-source')).not.toContain('file-changed');
      }),
    ),
  );
});
