import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import type { HostedContent, HostedMessage } from '@runlith/hosted-runner/wire/messages';
import { servedName } from './names.js';
import type { ClaudeSdk } from './channel.js';
import type { PromptBlock } from './translate.js';
import { wireNameOf } from './vendor.js';
import type { ContentBlock } from '@runlith/acp/content';
import { historyBlocks } from '@runlith/hosted-runner/history';

export type Seat = { readonly id: string; readonly cwd: string; readonly version: string | null; readonly model: string | null };

export type Seeded = { readonly _tag: 'Transcript' } | { readonly _tag: 'Recap'; readonly recap: readonly ContentBlock[] };

const TOOL_ID = /[^A-Za-z0-9_-]/g;

const toolId = (id: string): string => id.replace(TOOL_ID, '_');

const wireOf = (name: string): string => wireNameOf(name) ?? (name.startsWith('mcp__') ? name : servedName(name));

const inputOf = (input: unknown): unknown => (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : { input });

const blocks = (content: readonly HostedContent[]): readonly PromptBlock[] =>
  content.flatMap((part): PromptBlock[] =>
    part.type === 'image'
      ? [{ type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } }]
      : part.text === ''
        ? []
        : [{ type: 'text', text: part.text }],
  );

const said = (content: readonly HostedContent[]): string =>
  content.map((part) => (part.type === 'text' ? part.text : `[${part.mimeType}]`)).join('\n');

export const transcriptOf = (
  history: readonly HostedMessage[],
  seat: { readonly id: string; readonly cwd: string; readonly version: string; readonly model: string | null },
  now: number,
): readonly Record<string, unknown>[] => {
  const entries: Record<string, unknown>[] = [];
  const started = now - history.length;
  let parent: string | null = null;
  const push = (type: 'user' | 'assistant', message: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const uuid = crypto.randomUUID();
    entries.push({
      parentUuid: parent,
      isSidechain: false,
      userType: 'external',
      cwd: seat.cwd,
      sessionId: seat.id,
      version: seat.version,
      gitBranch: '',
      type,
      message,
      uuid,
      timestamp: new Date(started + entries.length).toISOString(),
      ...extra,
    });
    parent = uuid;
  };
  for (const message of history) {
    if (message.role === 'user') {
      const content = blocks(message.content);
      if (content.length > 0) push('user', { role: 'user', content });
    } else if (message.role === 'assistant') {
      const content = message.content.map((part) =>
        part.type === 'text'
          ? { type: 'text', text: part.text }
          : { type: 'tool_use', id: toolId(part.id), name: wireOf(part.name), input: inputOf(part.input) },
      );
      push('assistant', {
        id: `msg_${crypto.randomUUID().replaceAll('-', '')}`,
        type: 'message',
        role: 'assistant',
        model: seat.model ?? 'claude',
        content,
        stop_reason: content.some((part) => part.type === 'tool_use') ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    } else {
      const content = blocks(message.content);
      push(
        'user',
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolId(message.id),
              content: content.length === 0 ? '' : content,
              is_error: message.failed ? true : undefined,
            },
          ],
        },
        { toolUseResult: said(message.content) },
      );
    }
  }
  return entries;
};

const projectDirectory = async (cwd: string): Promise<string> => {
  const real = (await realpath(cwd)).normalize('NFC');
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', real.replace(/[^a-zA-Z0-9]/g, '-'));
};

export const seed = Effect.fnUntraced(function* (
  sdk: ClaudeSdk,
  history: readonly HostedMessage[],
  seat: Seat,
  stderr: (text: string) => void,
) {
  const now = yield* Clock.currentTimeMillis;
  return yield* Effect.promise(async (): Promise<Seeded> => {
    const recap: Seeded = { _tag: 'Recap', recap: historyBlocks(history) };
    if (seat.version === null) {
      stderr('claude printed no version, so the session opens with the history as text instead\n');
      return recap;
    }
    const entries = transcriptOf(history, { ...seat, version: seat.version }, now);
    const directory = await projectDirectory(seat.cwd).catch(() => null);
    if (directory === null) return recap;
    const file = join(directory, `${seat.id}.jsonl`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, { flag: 'wx' });
      const read = await sdk.transcript(seat.id, seat.cwd);
      if (read.length === entries.length) return { _tag: 'Transcript' };
      stderr(
        `Claude Code read ${read.length} of the ${entries.length} entries of the transcript written from Tagma's journal; the session opens with the history as text instead\n`,
      );
    } catch (cause) {
      stderr(
        `the transcript of Tagma's journal could not be written for Claude Code: ${cause instanceof Error ? cause.message : String(cause)}; the session opens with the history as text instead\n`,
      );
    }
    await rm(file, { force: true });
    return recap;
  });
});
