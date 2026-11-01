import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq, sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Schema, Stream } from 'effect';
import type { ThreadCompactionEntry } from '@runlith/agent/transcript/entries';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { Compaction } from '../../../native-harness/contract/service/context.js';
import { compactionChoicesSchema } from '../../../native-harness/contract/wire/compactionChoices.js';
import { ThreadEvidence } from '../../../threads/contract/service/evidence.js';
import { thread, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const DEFERRED = 'apply_batch';

const FOREIGN = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' };

const SUMMARY = `## State\n${'The first turn revealed a deferred tool through tool_search and ended without calling it. '.repeat(24).trim()}`;

const offeredSchema = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });

const summarizing = (standing: ModelAccess['Service']): ModelAccess['Service'] => ({
  ...standing,
  request: (input) =>
    input.provider !== FOREIGN.provider
      ? standing.request(input)
      : {
          plannedOutputTokens: 8_000,
          stream: () => Stream.die('A summary never streams.'),
          object: () => Effect.die('A summary answers text.'),
          text: () =>
            Effect.succeed(
              new LLMResponse({
                message: Message.assistant(SUMMARY),
                events: [{ type: 'text-delta', id: 'summary', text: SUMMARY }],
                usage: new Usage({ inputTokens: 900, outputTokens: 600, totalTokens: 1_500 }),
                finishReason: 'stop',
              }),
            ),
        },
});

describe('the tools Tagma serves a Claude Code thread over its MCP door', () => {
  layer(protocolWorld({ name: 'hosted-reveals', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('protocol world', (it) => {
    const revealed = Effect.fnUntraced(function* (label: string) {
      const { world, projectId, agent, birth } = yield* ProtocolWorld;
      const files = yield* FileSystem.FileSystem;
      const report = yield* agent(label);
      const threadId = yield* birth();
      const db = Context.get(world.runtime.graph, MachineStore).db;
      const units = Context.get(world.runtime.graph, MachineUnits);
      const runStatus = (runId: string) =>
        Effect.map(
          units.read((unit) => unit.run(db.select().from(threadRun()).where(eq(threadRun().id, runId)).get())),
          (row) => (row?.status === 'completed' ? true : null),
        );
      const prompts = Effect.map(heard(report), (lines) => lines.filter((line) => line.method === 'session/prompt').length);
      const prompted = (count: number) => Effect.map(prompts, (seen) => (seen >= count ? true : null));
      const asThread = (id: string, input: object) => world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId) });
      const turns = turnsOf(world.runtime.owners);

      const first = yield* turns.send(threadId, projectId, 'HOLD the turn');
      yield* until(prompted(1), 'the first turn reached the agent', report);
      yield* asThread('open_hosted_turn', {});
      yield* files.writeFileString(`${report}.search`, `select:${DEFERRED}`);
      yield* until(
        Effect.map(files.readFileString(`${report}.out`), (out) => (out.includes('said-search') ? true : null)),
        'the agent sealed its search',
        report,
      );
      yield* asThread('call_hosted_tool', { toolCallId: 'search-call', name: 'tool_search', input: { query: `select:${DEFERRED}` } });
      yield* files.writeFileString(`${report}.release`, 'release');
      yield* until(runStatus(first.runId), 'the first turn ended', report);
      yield* files.remove(`${report}.release`, { force: true });

      const answered = Effect.fnUntraced(function* (words: string) {
        const turn = yield* turns.send(threadId, projectId, words);
        yield* until(runStatus(turn.runId), `the turn "${words}" ended`, report);
      });
      const served = Effect.fnUntraced(function* () {
        const before = yield* prompts;
        yield* turns.send(threadId, projectId, 'HOLD the next turn');
        yield* until(prompted(before + 1), 'the next turn reached the agent', report);
        yield* asThread('open_hosted_turn', {});
        const offered = yield* Schema.decodeUnknownEffect(offeredSchema)((yield* asThread('read_hosted_tools', {})).body);
        return offered.tools.map((tool) => tool.name);
      });
      return { world, projectId, threadId, report, runStatus, answered, served };
    });

    const ownFold = Effect.fnUntraced(function* (label: string, keep?: string) {
      const { world, projectId, threadId, report, runStatus, served } = yield* revealed(label);
      const choices = yield* Schema.decodeUnknownEffect(compactionChoicesSchema)(
        (yield* world.op('read_compaction_choices', { threadId }, `project=${projectId}`)).body,
      );
      if (choices.own === null) return yield* Effect.die('a Claude Code thread folds its own session');
      const folded = yield* Context.get(world.runtime.owners, Compaction).compact(threadId, projectId, {
        summarizer: { provider: choices.own.provider, model: choices.own.model, reasoning: choices.own.reasoning },
        keep,
      });
      if (folded.status !== 'started') return yield* Effect.die(new Error(`the compaction answered ${folded.status}`));
      yield* until(runStatus(folded.runId), 'Claude Code compacted its session', report);
      return yield* served();
    });

    it.effect('a deferred tool revealed before Claude Code compacts its session is still served on the next turn', () =>
      Effect.gen(function* () {
        expect(yield* ownFold('own')).toContain(DEFERRED);
      }),
    );

    it.effect(
      'a deferred tool revealed before a compaction whose retelling the agent keeps to itself is still served on the next turn',
      () =>
        Effect.gen(function* () {
          expect(yield* ownFold('silent', 'SILENT')).toContain(DEFERRED);
        }),
    );

    it.effect('a thread seated under a tool catalog its profile no longer declares takes the profile’s catalog when its agent opens', () =>
      Effect.gen(function* () {
        const { world, projectId, agent, birth } = yield* ProtocolWorld;
        const report = yield* agent('reseated');
        const threadId = yield* birth();
        const db = Context.get(world.runtime.graph, MachineStore).db;
        const units = Context.get(world.runtime.graph, MachineUnits);
        yield* units.write('testing.staleCatalog', (unit) =>
          unit.run(
            db
              .update(thread())
              .set({ capabilities: sql`json_set(${thread().capabilities}, '$.toolCatalog', 'turn')` as never })
              .where(eq(thread().id, threadId)),
          ),
        );
        const catalog = Effect.map(
          units.read((unit) =>
            unit.run(db.select({ capabilities: thread().capabilities }).from(thread()).where(eq(thread().id, threadId)).get()),
          ),
          (row) => row?.capabilities.toolCatalog,
        );
        expect(yield* catalog).toBe('turn');
        yield* turnsOf(world.runtime.owners).send(threadId, projectId, 'HOLD the turn');
        yield* until(
          Effect.map(heard(report), (lines) => (lines.some((line) => line.method === 'session/prompt') ? true : null)),
          'the turn reached the agent',
          report,
        );
        expect(yield* catalog).toBeUndefined();
      }),
    );

    it.effect('a deferred tool revealed before a foreign model compacts the thread is still served on the next turn', () =>
      Effect.gen(function* () {
        const { world, projectId, threadId, report, runStatus, answered, served } = yield* revealed('foreign');
        yield* answered('The second turn.');
        yield* answered('The third turn.');
        yield* world.lend({ models: summarizing });
        const folded = yield* Context.get(world.runtime.owners, Compaction).compact(threadId, projectId, { summarizer: FOREIGN });
        if (folded.status !== 'started') return yield* Effect.die(new Error(`the compaction answered ${folded.status}`));
        yield* until(runStatus(folded.runId), 'the foreign model folded the thread', report);
        const transcript = (yield* Context.get(world.runtime.owners, ThreadEvidence).snapshot(threadId, projectId)).transcript;
        expect(
          transcript.find((entry): entry is ThreadCompactionEntry => entry.type === 'compaction' && entry.runId === folded.runId),
        ).toMatchObject({ status: 'completed', summarizer: { provider: FOREIGN.provider, own: false } });

        expect(yield* served()).toContain(DEFERRED);
      }),
    );
  });
});
