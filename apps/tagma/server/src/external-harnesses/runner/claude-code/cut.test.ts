import { expect } from 'bun:test';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { Effect, FileSystem, Stream } from 'effect';
import source from '../../testing/fixtures/claude-code/source.jsonl' with { type: 'text' };
import full from '../../testing/fixtures/claude-code/sdk-full.jsonl' with { type: 'text' };
import prefix from '../../testing/fixtures/claude-code/sdk-prefix.jsonl' with { type: 'text' };
import started from '../../testing/fixtures/claude-code/session-start.jsonl' with { type: 'text' };
import { serveCut, CutRefused, type Forking } from './cut.js';

const HOME = '/fixture/home/.claude';
const PROJECT = join(HOME, 'projects', 'fixture');
const WORKSPACE = '/fixture/workspace';
const ROOT = 'c252b18d-e481-452e-8449-a632720da358';
const FULL = '1fc80a2c-3ad0-4331-a75b-15fd97028d6a';
const PREFIX = '32a3a5d9-7fd0-43ab-9ca4-5ea7f6932855';
const AFTER_A = 'cc2fcffe-4f56-4ca1-9bac-513e81529f44';

const hooks = started
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as { readonly session_id: string; readonly transcript_path: string });
const resumedAt = (id: string) => hooks.find((hook) => hook.session_id === id)?.transcript_path;

it.effect('the cut server forks a root offline to its vendor copy and answers the turns of that copy', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    yield* files.makeDirectory(join(HOME, 'projects', 'other'), { recursive: true });
    yield* files.makeDirectory(PROJECT, { recursive: true });
    yield* files.writeFileString(join(PROJECT, `${ROOT}.jsonl`), source);
    const fork: Forking = Effect.fnUntraced(
      function* (root: string, options: Parameters<Forking>[1]) {
        if (!(yield* files.exists(join(PROJECT, `${root}.jsonl`))) || options.dir !== WORKSPACE)
          return yield* new CutRefused({ code: -32603, message: `Session ${root} not found` });
        if (options.upToMessageId !== undefined && options.upToMessageId !== AFTER_A)
          return yield* new CutRefused({ code: -32603, message: `Message ${options.upToMessageId} not found` });
        const [id, text] = options.upToMessageId === undefined ? [FULL, full] : [PREFIX, prefix];
        yield* files.writeFileString(join(PROJECT, `${id}.jsonl`), text);
        return id;
      },
      Effect.catchTag('PlatformError', Effect.die),
    );
    const requests = [
      { id: 1, method: 'initialize', params: { client: { name: 'tagma', version: '0.1.0' } } },
      { id: 2, method: 'fork', params: { root: ROOT, address: AFTER_A, dir: WORKSPACE } },
      { id: 3, method: 'turns', params: { root: PREFIX } },
      { id: 4, method: 'fork', params: { root: ROOT, address: null, dir: WORKSPACE } },
      { id: 5, method: 'turns', params: { root: FULL } },
      { id: 6, method: 'fork', params: { root: 'missing', address: null, dir: WORKSPACE } },
      { id: 7, method: 'turns', params: { root: 'absent' } },
      { id: 8, method: 'fork', params: { root: 7 } },
      { id: 9, method: 'thread/start', params: {} },
    ];
    const encoder = new TextEncoder();
    const written: string[] = [];
    yield* serveCut(
      Stream.fromIterable(requests.map((request) => encoder.encode(`${JSON.stringify({ jsonrpc: '2.0', ...request })}\n`))),
      (bytes) => Effect.sync(() => void written.push(new TextDecoder().decode(bytes))),
      { fork, home: HOME },
    );
    const answers = new Map(
      written
        .map((line) => JSON.parse(line) as { id: number; result?: unknown; error?: { code: number } })
        .map((answer) => [answer.id, answer]),
    );
    expect(answers.get(1)?.result).toMatchObject({});
    expect(answers.get(2)?.result).toEqual({ sessionId: PREFIX, path: resumedAt(PREFIX) });
    expect(answers.get(3)?.result).toEqual({ addresses: [null] });
    expect(answers.get(4)?.result).toEqual({ sessionId: FULL, path: resumedAt(FULL) });
    expect(answers.get(5)?.result).toEqual({
      addresses: [null, 'a363fc3f-c981-4f9f-8c86-1775634800bd', 'c9d4502b-6f0d-4d44-adb4-89299d9b9aad'],
    });
    expect([6, 7, 8, 9].map((id) => answers.get(id)?.error?.code)).toEqual([-32603, -32002, -32602, -32601]);
  }).pipe(Effect.provide(MemoryFileSystem.layer)),
);
