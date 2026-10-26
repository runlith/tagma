import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { Agent } from '@runlith/agent/Agent';
import { makeAgentRunner } from '@runlith/agent/AgentRunner';
import { RunStop } from '@runlith/agent/RunStop';
import type { ModelRequest } from '@runlith/agent/modelPort';
import { modeOfLookup } from '@runlith/agent/modes/ApprovalMode';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { versionedShelf } from '../../artifacts/testing/doubles.js';
import { TIMELINE_DECLARATION } from '../../artifacts/contract/wire/fragment.js';
import { PUBLISH_TOOL, publishedPageSchema } from '../../artifacts/contract/wire/published.js';
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

const calling = (calls: readonly { readonly id: string; readonly input: unknown }[]): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  ...calls.flatMap(({ id, input }): LLMEvent[] => [
    { type: 'tool-input-start', id, name: PUBLISH_TOOL },
    { type: 'tool-call', id, name: PUBLISH_TOOL, input },
  ]),
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage: USAGE },
];

const answered: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', text: 'Published.' },
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

const readPublished = Schema.decodeUnknownEffect(publishedPageSchema);

const answerOf = (messages: readonly Message[], id: string) => {
  const part = messages.flatMap((message) => message.content).find((one) => one.type === 'tool-result' && one.id === id);
  return readPublished(part?.type === 'tool-result' ? part.result.value : undefined);
};

layer(BunFileSystem.layer, { excludeTestServices: true })('publish_artifact', (it) => {
  it.effect('answers the page id, the address of its version and the timeline the page declares, or why the declaration was refused', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'publish-artifact-' });
        const motion = join(root, 'intro.html');
        const odd = join(root, 'odd.html');
        writeFileSync(motion, `<!doctype html><title>Intro</title>${TIMELINE_DECLARATION}<div id="stage"></div>`);
        writeFileSync(
          odd,
          '<!doctype html><title>Odd</title><script type="application/json" id="tagma-timeline">{"v":1,"duration":301,"fps":29,"width":1921,"height":1080}</script>',
        );
        const store = yield* versionedShelf(join(root, 'shelf'), 'http://localhost:5634');
        const machine = makeMachineWorld(() => null);
        const world = checkoutWorld({ projectRoot: root, scratch: join(root, 'scratch'), world: machine });
        const tools = artifactSkill(store).tools!({ thread: { id: 'thread-1' }, world });
        const agent = new Agent({
          id: 'tagma',
          name: 'Publisher',
          description: 'Publishes pages.',
          instructions: () => 'Publish the pages.',
          tools: () => tools,
          stopWhen: [],
        });
        const asked: (readonly Message[])[] = [];
        const model = scripted(
          [
            calling([
              { id: 'motion', input: { path: motion } },
              { id: 'odd', input: { path: odd } },
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
            messages: [Message.user('Publish both pages.')],
            approval: { mode: 'trust', interactive: false },
            modeOf: modeOfLookup(builtinModeRegistry(), 'trust'),
          },
          { push: () => Effect.void },
        );
        expect(yield* run.output.text).toBe('Published.');
        const results = asked[1] ?? [];
        const published = yield* answerOf(results, 'motion');
        const current = yield* store.page(published.id);
        expect(published).toMatchObject({
          id: current?.record.id,
          version: current?.record.version,
          versionUrl: `http://localhost:5634/a/${published.id}/v/${published.version}`,
          timeline: { v: 1, duration: 6, fps: 30, width: 1920, height: 1080 },
        });
        expect(published.timelineProblem).toBeUndefined();
        const refused = yield* answerOf(results, 'odd');
        expect(refused.timeline).toBeNull();
        for (const field of ['"duration"', '"fps"', '"width"']) expect(refused.timelineProblem).toContain(field);
      }),
    ),
  );
});
