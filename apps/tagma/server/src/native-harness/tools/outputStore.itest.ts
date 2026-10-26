import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import { Message, type ToolResultPart } from '@runlith/llm/schema/messages';
import type { ThreadOpenInputHold } from '@runlith/agent/thread/toolOutputs';
import { type ThreadToolOutputStore, toolOutputStore } from './outputStore.js';

const home = (): string => mkdtempSync(join(tmpdir(), 'tagma-tool-output-'));

const scopeOf = (store: ThreadToolOutputStore, threadId: string) => store.scope({ threadId, ownerId: 'owner', runId: null });

const idOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32);

const pathOf = (root: string, threadId: string, text: string): string => join(root, threadId, `${idOf(text)}.txt`);

const textOf = (output: { type: string; value: unknown }): string => String(output.value);

const callerOf = (threadId: string) => ({ agentId: 'agent', ownerId: 'owner', thread: { threadId, runId: 'run-1', bindings: {} } });

const reader = (scope: ReturnType<typeof scopeOf>, threadId: string, toolCallId: string) => {
  const tool = scope.tools.read_tool_output;
  return (outputId: string, offset = 0) =>
    (tool?.execute as unknown as (input: unknown, call: unknown) => Effect.Effect<unknown, { readonly _tag: string }>)(
      { outputId, offset },
      { toolCallId, caller: callerOf(threadId), messages: [] },
    );
};

describe('the tool output envelope', () => {
  it.effect('a file-backed report remains retrievable after its producer releases the original', () =>
    Effect.gen(function* () {
      const root = home();
      const sourcePath = join(root, 'report.jsonl');
      const whole = `${'completed deletion\n'.repeat(3000)}last outcome`;
      writeFileSync(sourcePath, whole);
      const scope = scopeOf(toolOutputStore(root), 'source-thread');
      const projection = yield* scope.project({
        toolCallId: 'source-call',
        toolName: 'delete',
        output: { status: 'cancelled' },
        modelOutput: { type: 'text', value: 'Deletion stopped; two files were removed.' },
        keep: 'head',
        source: {
          path: sourcePath,
          byteLength: Buffer.byteLength(whole),
          lineCount: 3001,
          format: 'text',
          retained: () => unlinkSync(sourcePath),
        },
      });
      const kept = projection.retained;
      if (kept?.location === undefined) return yield* Effect.die('The file source was not retained.');
      expect(existsSync(sourcePath)).toBe(false);
      expect(readFileSync(kept.location, 'utf8')).toBe(whole);
      expect(String(yield* reader(scope, 'source-thread', 'read-source')(kept.outputId, whole.length - 12))).toContain('last outcome');
    }),
  );

  it.effect('an oversized answer is bounded everywhere and kept whole in a file the marker names', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const whole = `${'the command said something\n'.repeat(4000)}the verdict`;

      const projection = yield* scopeOf(store, 't-1').project({
        toolCallId: 'call-1',
        toolName: 'bash',
        output: whole,
        modelOutput: { type: 'text', value: whole },
        keep: 'tail',
      });

      const shown = textOf(projection.modelOutput as { type: string; value: unknown });
      expect(Buffer.byteLength(shown, 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
      expect(shown).toContain('tool output truncated');
      expect((projection.output as { truncated?: boolean }).truncated).toBe(true);

      const path = pathOf(root, 't-1', whole);
      expect(shown).toContain(path);
      expect(readFileSync(path, 'utf8')).toBe(whole);
      expect(shown).toContain('the verdict');
    }),
  );

  it.effect('a model policy retains content before the host envelope would bound it', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const retention = { retainAboveCharacters: 50_000 } as const;
      const text = 'x'.repeat(retention.retainAboveCharacters + 49);
      const modelOutput = { type: 'content', value: [{ type: 'text', text }] } as const;
      const content = JSON.stringify(modelOutput.value, null, 2);

      expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(TOOL_OUTPUT_MAX_BYTES);
      const projection = yield* scopeOf(store, 't-10').project({
        toolCallId: 'call-10',
        toolName: 'read_events',
        output: modelOutput,
        modelOutput,
        keep: 'head',
        retention,
      });

      const location = pathOf(root, 't-10', text);
      const contentLocation = join(root, 't-10', `${idOf(content)}.json`);
      expect(projection.retained).toEqual({
        outputId: idOf(text),
        format: 'text',
        byteLength: text.length,
        lineCount: 1,
        location,
        contentLocation,
      });
      expect(readFileSync(location, 'utf8')).toBe(text);
      expect(readFileSync(contentLocation, 'utf8')).toBe(content);
      const read = reader(scopeOf(store, 't-10'), 't-10', 'read-content');
      expect(String(yield* read(idOf(content)))).toContain(content);
      expect(String(yield* read(idOf(content), content.length - 8))).toContain(content.slice(-8));
      expect(yield* Effect.flip(read('0'.repeat(32)))).toMatchObject({ _tag: 'Tool.Failed' });
    }),
  );

  it.effect('a retained answer keeps the pictures it carries beside its cut text', () =>
    Effect.gen(function* () {
      const store = toolOutputStore(home());
      const retention = { retainAboveCharacters: 50_000 } as const;
      const picture = { type: 'file', uri: '/api/threads/t-12/attachments/shot.png', mime: 'image/png', name: 'shot.png' } as const;
      const modelOutput = {
        type: 'content',
        value: [{ type: 'text', text: 'x'.repeat(retention.retainAboveCharacters + 49) }, picture],
      } as const;

      const projection = yield* scopeOf(store, 't-12').project({
        toolCallId: 'call-12',
        toolName: 'browser_snapshot',
        output: modelOutput,
        modelOutput,
        keep: 'head',
        retention,
      });

      expect(projection.retained).toBeDefined();
      expect(projection.modelOutput.type === 'content' ? projection.modelOutput.value.slice(1) : []).toEqual([picture]);
    }),
  );

  it.effect('a retained answer in plain words keeps the single block it is', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const retention = { retainAboveCharacters: 50_000 } as const;
      const text = 'x'.repeat(retention.retainAboveCharacters + 49);
      const modelOutput = { type: 'text', value: text } as const;
      const content = JSON.stringify([{ type: 'text', text }], null, 2);

      const projection = yield* scopeOf(store, 't-11').project({
        toolCallId: 'call-11',
        toolName: 'bash',
        output: modelOutput,
        modelOutput,
        keep: 'head',
        retention,
      });

      const contentLocation = join(root, 't-11', `${idOf(content)}.json`);
      expect(projection.retained?.contentLocation).toBe(contentLocation);
      expect(readFileSync(contentLocation, 'utf8')).toBe(content);
    }),
  );

  it.effect('a structured value past the wire ceiling is retained whole while the model keeps its own answer', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const answer = {
        status: 'ok',
        rows: Array.from({ length: 45_000 }, (_, at) => ({
          at,
          id: `tool:01a08b01-0000-7000-8000-00000000${String(at).padStart(4, '0')}`,
          kind: 'tool',
          toolName: 'read_thread',
          text: '"'.repeat(64),
        })),
      };
      const modelOutput = { type: 'text', value: 'rows 1-45000 of thread 01a08b01' } as const;
      const scope = scopeOf(store, 't-8');

      const projection = yield* scope.project({
        toolCallId: 'call-8',
        toolName: 'read_thread',
        output: answer,
        modelOutput,
        keep: 'head',
      });

      expect(projection.modelOutput).toEqual(modelOutput);
      expect(JSON.stringify(projection.output).length).toBeLessThanOrEqual(WIRE_ENTRY_MAX_BYTES);

      const json = JSON.stringify(answer);
      expect(readFileSync(pathOf(root, 't-8', json), 'utf8')).toBe(json);
      const outputId = idOf(json);
      expect((projection.output as { outputId: string }).outputId).toBe(outputId);

      const paged = yield* reader(scope, 't-8', 'call-9')(outputId, 0);
      expect(String(paged)).toContain('"toolName":"read_thread"');
      expect(String(paged)).toContain(`of ${Buffer.byteLength(json, 'utf8')}`);
    }),
  );

  it.effect('replaying a history bounds the model half alone and writes no file for the value behind it', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const result = {
        type: 'content',
        value: [
          { type: 'text', text: 'screenshot taken' },
          { type: 'file', uri: `data:image/png;base64,${'A'.repeat(300_000)}`, mime: 'image/png' },
        ],
      } as const;
      expect(JSON.stringify(result).length).toBeGreaterThan(WIRE_ENTRY_MAX_BYTES);
      const message = Message.tool({ id: 'call-10', name: 'take_screenshot', result });

      const replayed = yield* scopeOf(store, 't-9').projectMessages([message]);

      expect((replayed[0]?.content[0] as ToolResultPart).result).toEqual(result);
      expect(existsSync(join(root, 't-9'))).toBe(false);
    }),
  );

  it.effect('an answer inside the ceiling passes through and writes nothing', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);

      const projection = yield* scopeOf(store, 't-2').project({
        toolCallId: 'call-2',
        toolName: 'bash',
        output: 'small',
        modelOutput: { type: 'text', value: 'small' },
        keep: 'head',
      });

      expect(projection.output).toBe('small');
      expect(existsSync(join(root, 't-2'))).toBe(false);
    }),
  );

  it.effect('the retrieval tool pages the retained bytes from an offset', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const whole = 'abcdefghij\n'.repeat(20_000);
      const scope = scopeOf(store, 't-3');
      yield* scope.project({
        toolCallId: 'call-3',
        toolName: 'bash',
        output: whole,
        modelOutput: { type: 'text', value: whole },
        keep: 'head',
      });

      const read = reader(scope, 't-3', 'call-4');
      expect(String(yield* read(idOf(whole), 0))).toContain('abcdefghij');
      expect(String(yield* read(idOf(whole), whole.length))).toContain('End of tool output');
    }),
  );

  it.effect('a fork links the same bytes and releasing one thread leaves the other readable', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const whole = 'y'.repeat(TOOL_OUTPUT_MAX_BYTES * 2);
      yield* scopeOf(store, 't-6').project({
        toolCallId: 'call-6',
        toolName: 'bash',
        output: whole,
        modelOutput: { type: 'text', value: whole },
        keep: 'head',
      });

      yield* store.copyForThread('t-6', 't-7');
      expect(existsSync(pathOf(root, 't-7', whole))).toBe(true);

      yield* store.releaseThread('t-6');
      expect(existsSync(pathOf(root, 't-6', whole))).toBe(false);
      expect(existsSync(pathOf(root, 't-7', whole))).toBe(true);
    }),
  );

  it('a file standing at a digest is read back before it is trusted, and a lie is replaced', async () => {
    const root = home();
    const store = toolOutputStore(root);
    const whole = 'the whole document';
    mkdirSync(join(root, 't-8'), { recursive: true });
    writeFileSync(pathOf(root, 't-8', whole), 'the who');

    const written = await store.write('t-8', whole);

    expect(readFileSync(written.path, 'utf8')).toBe(whole);
    const before = statSync(written.path).ino;
    await store.write('t-8', whole);
    expect(statSync(written.path).ino).toBe(before);
  });

  it.effect('interrupted arguments stay in the row under the ceiling and become a file past it', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const small = '{"content":"half a line';
      const large = `{"content":"${'z'.repeat(WIRE_ENTRY_MAX_BYTES)}`;

      const kept = yield* scopeOf(store, 't-10').retainInterrupted({ toolCallId: 'c-1', toolName: 'write', text: small, complete: false });
      expect(kept).toEqual({ kind: 'text', text: small, complete: false });

      const spilled = yield* scopeOf(store, 't-10').retainInterrupted({
        toolCallId: 'c-2',
        toolName: 'write',
        text: large,
        complete: false,
      });
      expect(spilled).toMatchObject({ kind: 'retained', byteLength: Buffer.byteLength(large, 'utf8'), complete: false });
      const location = (spilled as { location: string }).location;
      expect(readFileSync(location, 'utf8')).toBe(large);
    }),
  );

  it.effect('an arriving input stays in the row under the ceiling, then grows one file by what arrived', () =>
    Effect.gen(function* () {
      const root = home();
      const scope = scopeOf(toolOutputStore(root), 't-11');
      const first = `{"content":"caf\u00e9 ${'z'.repeat(WIRE_ENTRY_MAX_BYTES / 2)}`;
      const second = `${first}${'y'.repeat(WIRE_ENTRY_MAX_BYTES)}\ud83d`;
      const third = `${second}\ude00\u00e9 \ud83d`;
      const whole = `${third}\ude00 and the rest`;
      const open = (text: string, held: ThreadOpenInputHold | null) =>
        scope.retainOpen({ toolCallId: 'c-3', toolName: 'write', text, held });

      const inline = yield* open(first, null);
      expect(inline.input).toEqual({ kind: 'text', text: first, complete: false });
      const spilled = yield* open(second, inline);
      const grown = yield* open(whole, yield* open(third, spilled));

      expect(grown.input).toMatchObject({ kind: 'retained', byteLength: Buffer.byteLength(whole, 'utf8'), complete: false });
      expect(grown.input).toMatchObject({ outputId: (spilled.input as { outputId: string }).outputId });
      expect(readFileSync((grown.input as { location: string }).location, 'utf8')).toBe(whole);
      expect(readdirSync(join(root, 't-11'))).toHaveLength(1);
    }),
  );

  it.effect('a settled open input keeps exactly its recorded bytes, and a torn suffix past them is gone', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const received = `{"content":"${'q'.repeat(WIRE_ENTRY_MAX_BYTES)} caf\u00e9`;
      const held = yield* scopeOf(store, 't-12').retainOpen({ toolCallId: 'c-4', toolName: 'write', text: received, held: null });
      const location = (held.input as { location: string }).location;
      appendFileSync(location, Buffer.from([0x20, 0xf0, 0x9f, 0x98]));

      yield* store.settleOpen('t-12', [held.input]);

      expect(readFileSync(location, 'utf8')).toBe(received);
      expect(statSync(location).size).toBe((held.input as { byteLength: number }).byteLength);
    }),
  );

  it.effect('releasing a thread takes its outputs with it', () =>
    Effect.gen(function* () {
      const root = home();
      const store = toolOutputStore(root);
      const whole = 'x'.repeat(TOOL_OUTPUT_MAX_BYTES * 2);
      yield* scopeOf(store, 't-4').project({
        toolCallId: 'call-5',
        toolName: 'bash',
        output: whole,
        modelOutput: { type: 'text', value: whole },
        keep: 'head',
      });
      expect(existsSync(pathOf(root, 't-4', whole))).toBe(true);

      yield* store.releaseThread('t-4');
      expect(existsSync(pathOf(root, 't-4', whole))).toBe(false);
    }),
  );
});
