import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { copyFile, link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TOOL_OUTPUT_MAX_BYTES, formatToolOutputRange, type ToolOutputKeep } from '@runlith/agent/ToolOutputSpool';
import { Tool, ToolFailed, callerThread } from '@runlith/agent/tool';
import {
  boundAgentToolOutput,
  inspectAgentToolOutput,
  projectToolResultMessages,
  type AgentToolModelOutput,
  type AgentToolOutputProjection,
  type AgentToolOutputInput,
  type AgentToolOutputs,
} from '@runlith/agent/ToolOutput';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import { AgentHostFailed } from '@runlith/agent/AgentFailure';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadInterruptedInput } from '@runlith/agent/transcript/entries';
import type { ThreadOpenInputHold, ThreadToolOutputContext } from '@runlith/agent/thread/toolOutputs';
import type { ThreadToolOutputScopeFaces } from '@runlith/agent/thread/ThreadPorts';
import { Data, Effect, Schema } from 'effect';
import type { Unit } from '../../platform/contract/service/units.js';
import type { RetainedToolValue } from '../contract/wire/toolResult.js';
import { RETRIEVAL_TOOL } from './outputWords.js';
import type { LayerSources } from '../../threads/journal/base.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../platform/contract/wire/conditions.js';

const RETAINED_PREVIEW_CHARS = WIRE_ENTRY_MAX_BYTES / 4;

const THREAD_ID = /^[0-9a-zA-Z-]{1,64}$/;

const ReadToolOutputInput = Schema.Struct({
  outputId: Schema.String,
  offset: Schema.optional(Schema.Number),
});

export class ToolOutputMissing extends Data.TaggedError('ToolOutputMissing')<{ readonly message: string }> {
  constructor(outputId: string) {
    super({ message: `Tool output ${outputId} not found.` });
    this.name = 'ToolOutputMissing';
  }
}

export type RetainedAnswer = { readonly value: Schema.Json } | { readonly unavailable: string };

export type ThreadToolOutputStore = ReturnType<typeof toolOutputStore>;

const NO_SOURCES: LayerSources = () => Effect.succeed([]);

export const toolOutputStore = (root: string, sources: LayerSources = NO_SOURCES) => {
  const readers = (threadId: string) => Effect.map(sources(threadId), (found): readonly string[] => [threadId, ...found]);
  const unread = (failure: { readonly message: string }) => Effect.succeed({ unavailable: failure.message });
  const directory = (threadId: string): string => {
    if (!THREAD_ID.test(threadId)) throw new ToolOutputMissing(threadId);
    return join(root, threadId);
  };

  const pathOf = (threadId: string, outputId: string, extension: 'txt' | 'json' = 'txt'): string => {
    if (!/^[0-9a-f]{32}$/.test(outputId)) throw new ToolOutputMissing(outputId);
    return join(directory(threadId), `${outputId}.${extension}`);
  };

  const land = async (threadId: string, path: string, text: string): Promise<void> => {
    await mkdir(directory(threadId), { recursive: true });
    const staging = `${path}.${randomUUID()}.part`;
    try {
      await writeFile(staging, text);
      const staged = await open(staging, 'r');
      try {
        await staged.sync();
      } finally {
        await staged.close();
      }
      await rename(staging, path);
      const folder = await open(directory(threadId), 'r');
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    } catch (cause) {
      await rm(staging, { force: true }).catch(() => {});
      throw cause;
    }
  };

  const holds = async (path: string, text: string): Promise<boolean> => {
    let standing: string;
    try {
      standing = await readFile(path, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw cause;
    }
    return standing === text;
  };

  const write = async (threadId: string, text: string, extension: 'txt' | 'json' = 'txt'): Promise<{ outputId: string; path: string }> => {
    const outputId = outputIdOf(text);
    const path = pathOf(threadId, outputId, extension);
    if (await holds(path, text)) return { outputId, path };
    await land(threadId, path, text);
    return { outputId, path };
  };

  const begin = async (threadId: string, text: string): Promise<{ outputId: string; path: string }> => {
    const outputId = randomUUID().replaceAll('-', '');
    const path = pathOf(threadId, outputId);
    await land(threadId, path, text);
    return { outputId, path };
  };

  const extend = async (threadId: string, outputId: string, text: string): Promise<void> => {
    const file = await open(pathOf(threadId, outputId), 'a');
    try {
      await file.appendFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
  };

  const cut = async (path: string, byteLength: number): Promise<void> => {
    let file: Awaited<ReturnType<typeof open>>;
    try {
      file = await open(path, 'r+');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw cause;
    }
    try {
      if ((await file.stat()).size <= byteLength) return;
      await file.truncate(byteLength);
      await file.sync();
    } finally {
      await file.close();
    }
  };

  const retain = async (threadId: string, json: string): Promise<RetainedToolValue> => {
    const written = await write(threadId, json);
    const bounded = boundAgentToolOutput(
      { type: 'text', value: json.slice(0, RETAINED_PREVIEW_CHARS) },
      {
        outputId: written.outputId,
        byteLength: Buffer.byteLength(json, 'utf8'),
        lineCount: 1,
        retrievalTool: RETRIEVAL_TOOL,
        location: written.path,
        format: 'json',
      },
    );
    return { ...(bounded.output as Omit<RetainedToolValue, 'format'>), format: 'json' };
  };

  const bound = async (
    threadId: string,
    text: string,
    measured: {
      byteLength: number;
      lineCount: number;
      format: 'text' | 'json';
      content?: string;
      keep?: 'head' | 'tail';
      output?: AgentToolModelOutput;
    },
  ): Promise<AgentToolOutputProjection> => {
    const { outputId, path } = await write(threadId, text);
    const content = measured.content === undefined ? undefined : await write(threadId, measured.content, 'json');
    return boundAgentToolOutput(measured.output ?? { type: 'text', value: text }, {
      outputId,
      byteLength: measured.byteLength,
      lineCount: measured.lineCount,
      retrievalTool: RETRIEVAL_TOOL,
      location: path,
      contentLocation: content?.path,
      format: measured.format,
      keep: measured.keep,
    });
  };

  const boundForModel = async (
    threadId: string,
    modelOutput: AgentToolModelOutput,
    keep: ToolOutputKeep | undefined,
    retention?: Parameters<AgentToolOutputs['project']>[0]['retention'],
  ): Promise<AgentToolOutputProjection | null> => {
    const inspected = inspectAgentToolOutput(modelOutput);
    const shouldRetain = retention !== undefined && inspected.text.length > retention.retainAboveCharacters;
    if (!inspected.oversized && !shouldRetain) return null;
    return bound(threadId, inspected.text, {
      byteLength: inspected.byteLength,
      lineCount: inspected.lineCount,
      format: inspected.format,
      content:
        modelOutput.type === 'content' || modelOutput.type === 'json'
          ? JSON.stringify(modelOutput.value, null, 2)
          : JSON.stringify([{ type: 'text', text: inspected.text }], null, 2),
      keep,
      output: modelOutput,
    });
  };

  const boundSource = async (threadId: string, input: AgentToolOutputInput): Promise<AgentToolOutputProjection> => {
    const source = input.source;
    if (source === undefined) throw new Error('A file-backed tool answer must name its source.');
    const outputId = randomUUID().replaceAll('-', '');
    const path = pathOf(threadId, outputId);
    const staging = `${path}.${randomUUID()}.part`;
    await mkdir(directory(threadId), { recursive: true });
    try {
      await copyFile(source.path, staging);
      const file = await open(staging, 'r');
      try {
        const held = await file.stat();
        if (held.size !== source.byteLength)
          throw new Error(`Tool output source ${source.path} changed: expected ${source.byteLength} bytes, found ${held.size}.`);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(staging, path);
      const folder = await open(directory(threadId), 'r');
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    } finally {
      await rm(staging, { force: true });
    }
    source.retained?.();
    return boundAgentToolOutput(input.modelOutput, {
      outputId,
      byteLength: source.byteLength,
      lineCount: source.lineCount,
      retrievalTool: RETRIEVAL_TOOL,
      location: path,
      format: source.format,
      keep: input.keep,
    });
  };

  const opened = (threads: readonly string[], outputId: string): number => {
    for (const threadId of threads) {
      for (const extension of ['txt', 'json'] as const) {
        const path = pathOf(threadId, outputId, extension);
        try {
          return openSync(path, 'r');
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
        }
      }
    }
    throw new ToolOutputMissing(outputId);
  };

  const located = async (threads: readonly string[], outputId: string): Promise<string> => {
    for (const threadId of threads) {
      const path = pathOf(threadId, outputId);
      try {
        await stat(path);
        return path;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }
    }
    throw new ToolOutputMissing(outputId);
  };

  const range = (threads: readonly string[], outputId: string, requestedOffset: number): string => {
    if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
      throw new Error(`Offset ${requestedOffset} is not a byte position; pass a whole number of bytes from zero.`);
    }
    const fd = opened(threads, outputId);
    try {
      const totalLength = fstatSync(fd).size;
      if (requestedOffset >= totalLength) {
        return `[End of tool output ${outputId}; ${totalLength} bytes total.]`;
      }
      const length = Math.min(TOOL_OUTPUT_MAX_BYTES + 4, totalLength - requestedOffset);
      const buffer = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const read = readSync(fd, buffer, filled, length - filled, requestedOffset + filled);
        if (read <= 0) break;
        filled += read;
      }
      return formatToolOutputRange({
        outputId,
        requestedOffset,
        totalLength,
        bytes: new Uint8Array(buffer.subarray(0, filled)),
      });
    } finally {
      closeSync(fd);
    }
  };

  return {
    write,
    retain,
    scope: (context: ThreadToolOutputContext): ThreadToolOutputScopeFaces<Unit<'machine'>> => {
      const projected = (work: () => Promise<AgentToolOutputProjection>) =>
        Effect.tryPromise({ try: work, catch: (cause) => new AgentHostFailed({ port: 'toolOutputs', cause }) });
      const projectForModel: AgentToolOutputs['project'] = (input) =>
        projected(async () =>
          input.source !== undefined
            ? boundSource(context.threadId, input)
            : ((await boundForModel(context.threadId, input.modelOutput, input.keep, input.retention)) ?? {
                output: input.output,
                modelOutput: input.modelOutput,
              }),
        );
      const project: AgentToolOutputs['project'] = (input) =>
        projected(async () => {
          if (input.source !== undefined) return boundSource(context.threadId, input);
          const bounded = await boundForModel(context.threadId, input.modelOutput, input.keep, input.retention);
          if (bounded) return bounded;
          const stored = jsonOf(input.output);
          if (stored === null || stored.length <= WIRE_ENTRY_MAX_BYTES) {
            return { output: input.output, modelOutput: input.modelOutput };
          }
          return { output: await retain(context.threadId, stored), modelOutput: input.modelOutput };
        });
      return {
        project,
        projectMessages: (messages) => projectToolResultMessages(messages, projectForModel),
        retainInterrupted: ({ text, complete }) =>
          Effect.tryPromise({
            try: async (): Promise<ThreadInterruptedInput> => {
              const byteLength = Buffer.byteLength(text, 'utf8');
              if (byteLength <= WIRE_ENTRY_MAX_BYTES) return { kind: 'text', text, complete };
              const written = await write(context.threadId, text);
              return { kind: 'retained', outputId: written.outputId, byteLength, location: written.path, complete };
            },
            catch: (cause) => new ThreadStorageFailed({ call: 'retainInterrupted', cause }),
          }),
        retainOpen: ({ text, held }) =>
          Effect.tryPromise({
            try: async (): Promise<ThreadOpenInputHold> => {
              const standing = held?.input;
              const chars = wholeChars(text);
              if (standing?.kind === 'retained' && held !== null) {
                const appended = text.slice(held.chars, chars);
                if (appended.length === 0) return held;
                await extend(context.threadId, standing.outputId, appended);
                return { input: { ...standing, byteLength: standing.byteLength + Buffer.byteLength(appended, 'utf8') }, chars };
              }
              const byteLength = Buffer.byteLength(text, 'utf8');
              if (byteLength <= WIRE_ENTRY_MAX_BYTES) return { input: { kind: 'text', text, complete: false }, chars: text.length };
              const kept = text.slice(0, chars);
              const written = await begin(context.threadId, kept);
              const input: ThreadInterruptedInput = {
                kind: 'retained',
                outputId: written.outputId,
                byteLength: Buffer.byteLength(kept, 'utf8'),
                location: written.path,
                complete: false,
              };
              return { input, chars };
            },
            catch: (cause) => new ThreadStorageFailed({ call: 'retainOpen', cause }),
          }),
        commitReferenced: () => Effect.void,
        dispose: () => Effect.void,
        tools: {
          [RETRIEVAL_TOOL]: Tool.make({
            approval: ASKS_NEVER,
            exposure: 'deferred',
            description:
              'Read a bounded byte range from a complete tool output this thread retained after its model-visible preview was truncated. The truncation marker also names the file directly, which the file tools can read or search without paging.',
            parameters: ReadToolOutputInput,
            display: { streamFields: ['outputId'], project: (input) => ({ form: 'none', title: input.outputId }) },
            execute: (input, call) =>
              Effect.flatMap(callerThread(call.caller), (thread) =>
                Effect.flatMap(
                  readers(thread.threadId).pipe(Effect.mapError((failure) => new ToolFailed({ reason: failure.message }))),
                  (threads) =>
                    Effect.try({
                      try: () => range(threads, input.outputId, input.offset ?? 0),
                      catch: (cause) => new ToolFailed({ reason: cause instanceof Error ? cause.message : String(cause) }),
                    }),
                ),
              ),
          }),
        },
      };
    },
    copyForThread: (sourceThreadId: string, targetThreadId: string): Effect.Effect<void> =>
      Effect.promise(async () => {
        const source = directory(sourceThreadId);
        let held: readonly string[];
        try {
          held = await readdir(source);
        } catch {
          return;
        }
        if (held.length === 0) return;
        const target = directory(targetThreadId);
        await mkdir(target, { recursive: true });
        for (const name of held) await link(join(source, name), join(target, name));
      }),
    settleOpen: (threadId: string, inputs: readonly ThreadInterruptedInput[]): Effect.Effect<void, ThreadStorageFailed> =>
      Effect.tryPromise({
        try: async () => {
          for (const input of inputs) {
            if (input.kind !== 'retained') continue;
            await cut(pathOf(threadId, input.outputId), input.byteLength);
          }
        },
        catch: (cause) => new ThreadStorageFailed({ call: 'settleOpen', cause }),
      }),
    releaseThread: (threadId: string): Effect.Effect<void> =>
      Effect.promise(async () => {
        await rm(directory(threadId), { recursive: true, force: true });
      }),
    retained: (threadId: string, outputId: string): Effect.Effect<RetainedAnswer> =>
      readers(threadId).pipe(
        Effect.flatMap((threads) =>
          Effect.promise(async (): Promise<RetainedAnswer> => {
            try {
              return { value: JSON.parse(await readFile(await located(threads, outputId), 'utf8')) as Schema.Json };
            } catch (cause) {
              return { unavailable: cause instanceof Error ? cause.message : String(cause) };
            }
          }),
        ),
        Effect.catch(unread),
      ),
    slice: (threadId: string, outputId: string, from: number, length: number): Effect.Effect<RetainedSlice> =>
      readers(threadId).pipe(
        Effect.catch(unread),
        Effect.flatMap((threads) =>
          'unavailable' in threads
            ? Effect.succeed(threads)
            : Effect.promise(async (): Promise<RetainedSlice> => {
                try {
                  const file = await open(await located(threads, outputId), 'r');
                  try {
                    const total = (await file.stat()).size;
                    const start = Math.min(from, total);
                    const bytes = Buffer.alloc(Math.min(length, total - start));
                    let filled = 0;
                    while (filled < bytes.length) {
                      const { bytesRead } = await file.read(bytes, filled, bytes.length - filled, start + filled);
                      if (bytesRead <= 0) break;
                      filled += bytesRead;
                    }
                    return { bytes: bytes.subarray(0, filled), start, total };
                  } finally {
                    await file.close();
                  }
                } catch (cause) {
                  return { unavailable: cause instanceof Error ? cause.message : String(cause) };
                }
              }),
        ),
      ),
  };
};

export type RetainedSlice =
  | { readonly bytes: Uint8Array; readonly start: number; readonly total: number }
  | { readonly unavailable: string };

function wholeChars(text: string): number {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length;
}

function outputIdOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

function jsonOf(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}
