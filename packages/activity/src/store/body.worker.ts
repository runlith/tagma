/// <reference types="bun" />

import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunWorkerRunner from '@effect/platform-bun/BunWorkerRunner';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { opendir, rm, stat } from 'node:fs/promises';
import { Context, Effect, FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import * as WorkerRunner from 'effect/workers/WorkerRunner';
import { type BodyBucket, type BodyReply, type BodyRequest, BodyUnreadable } from './bodies';
import { assembled, encoded, type Revision, revisionOf } from './delta';
import type { BodyForm } from './writer';

const CHAINS = 16;
const SNAPSHOT_LINKS = 32;

type Files = Context.Service.Shape<typeof FileSystem.FileSystem>;

const main = Effect.scoped(
  Effect.gen(function* () {
    const platform = yield* WorkerRunner.WorkerRunnerPlatform;
    const runner = yield* platform.start<BodyReply, BodyRequest>();
    const fileSystem = yield* FileSystem.FileSystem;
    const chains = new Map<string, Revision>();

    yield* runner.run((_port, request) =>
      answer(fileSystem, chains, request).pipe(
        Effect.catchTag('PlatformError', (failure) =>
          Effect.succeed<BodyReply>({ _tag: 'Failed', key: request.key, reason: failure.message }),
        ),
        Effect.catchTag('BodyUnreadable', (failure) =>
          Effect.succeed<BodyReply>({ _tag: 'Failed', key: request.key, reason: failure.reason }),
        ),
        Effect.flatMap((reply) => runner.send(0, reply)),
      ),
    );
  }),
).pipe(Effect.provide(BunWorkerRunner.layer), Effect.provide(BunFileSystem.layer));

function answer(
  fileSystem: Files,
  chains: Map<string, Revision>,
  request: BodyRequest,
): Effect.Effect<BodyReply, PlatformError | BodyUnreadable> {
  switch (request._tag) {
    case 'Write':
      return write(fileSystem, chains, request);
    case 'Read':
      return read(fileSystem, request);
    case 'Discard':
      return Effect.gen(function* () {
        const ids = new Set(request.links.map((link) => link.id));
        for (const [chain, revision] of chains) if (ids.has(revision.id)) chains.delete(chain);
        for (const link of request.links) yield* fileSystem.remove(join(request.root, link.bucket, `${link.id}.json`), { force: true });
        return { _tag: 'Removed', key: request.key } satisfies BodyReply;
      });
    case 'Inventory':
      return Effect.gen(function* () {
        if (!(yield* fileSystem.exists(request.root))) return { _tag: 'Inventory', key: request.key, buckets: [] } satisfies BodyReply;
        for (const [chain, revision] of chains) if (revision.bucket < request.oldest) chains.delete(chain);
        return yield* inventory(request);
      });
    case 'Remove':
      return Effect.gen(function* () {
        for (const [chain, revision] of chains) if (revision.bucket === request.bucket) chains.delete(chain);
        yield* fileSystem.remove(request.path, { recursive: true, force: true });
        return { _tag: 'Removed', key: request.key } satisfies BodyReply;
      });
  }
}

const read = Effect.fnUntraced(function* (fileSystem: Files, request: Extract<BodyRequest, { readonly _tag: 'Read' }>) {
  if (!request.chained)
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(request.files[0]!, { flag: 'r' });
        const total = Number((yield* file.stat).size);
        const from = Math.min(request.from, total);
        yield* file.seek(BigInt(from), 'start');
        const bytes = Buffer.alloc(Math.min(request.bytes, total - from));
        let used = 0;
        while (used < bytes.length) {
          const count = yield* file.read(bytes.subarray(used));
          if (count === 0) break;
          used += count;
        }
        return bodyText(request.key, bytes.subarray(0, used), from, total);
      }),
    );
  const texts: string[] = [];
  for (const file of request.files) texts.push(yield* fileSystem.readFileString(file));
  const whole = attempt(() => assembled(texts));
  if (whole.failed !== undefined) return { _tag: 'Failed', key: request.key, reason: whole.failed } satisfies BodyReply;
  const bytes = Buffer.from(whole.value);
  const from = Math.min(request.from, bytes.length);
  return bodyText(request.key, bytes.subarray(from, from + request.bytes), from, bytes.length);
});

function bodyText(key: string, bytes: Buffer, from: number, total: number): BodyReply {
  const continues = (at: number) => at < bytes.length && (bytes[at]! & 0xc0) === 0x80;
  let start = 0;
  while (continues(start)) start += 1;
  let end = bytes.length;
  if (from + end < total) {
    let lead = end - 1;
    while (lead >= start && continues(lead)) lead -= 1;
    if (lead >= start) {
      const byte = bytes[lead]!;
      const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
      if (lead + width > end) end = lead;
    }
  }
  return { _tag: 'Read', key, text: bytes.subarray(start, Math.max(start, end)).toString('utf8'), from: from + start, bytes: total };
}

function inventory(request: Extract<BodyRequest, { readonly _tag: 'Inventory' }>): Effect.Effect<BodyReply, BodyUnreadable> {
  return Effect.tryPromise({
    try: async () => {
      const buckets: BodyBucket[] = [];
      for await (const entry of await opendir(request.root)) {
        if (!entry.isDirectory()) continue;
        const path = join(request.root, entry.name);
        if (entry.name < request.oldest) {
          await rm(path, { recursive: true, force: true });
          continue;
        }
        let bytes = 0;
        let bodies = 0;
        for await (const file of await opendir(path)) {
          if (!file.isFile()) continue;
          bytes += (await stat(join(path, file.name))).size;
          bodies += 1;
        }
        buckets.push({ bucket: entry.name, bytes, bodies });
      }
      return { _tag: 'Inventory', key: request.key, buckets } satisfies BodyReply;
    },
    catch: (cause) => new BodyUnreadable({ reason: String(cause) }),
  });
}

const write = Effect.fnUntraced(function* (
  fileSystem: Files,
  chains: Map<string, Revision>,
  request: Extract<BodyRequest, { readonly _tag: 'Write' }>,
) {
  const made = attempt(() => encode(chains, request));
  if (made.failed !== undefined) return { _tag: 'Failed', key: request.key, reason: made.failed } satisfies BodyReply;
  const { text, size, form, base, revision } = made.value;
  const bytes = Buffer.byteLength(text);
  if (bytes > request.ceiling) return { _tag: 'Declined', key: request.key, bytes } satisfies BodyReply;
  yield* fileSystem.makeDirectory(dirname(request.path), { recursive: true });
  yield* fileSystem.writeFileString(request.path, text);
  if (request.chain !== null && revision !== null) {
    chains.delete(request.chain);
    chains.set(request.chain, revision);
    for (const oldest of chains.keys()) {
      if (chains.size <= CHAINS) break;
      chains.delete(oldest);
    }
  }
  return { _tag: 'Written', key: request.key, bytes, size, form, base } satisfies BodyReply;
});

function encode(
  chains: ReadonlyMap<string, Revision>,
  request: Extract<BodyRequest, { readonly _tag: 'Write' }>,
): {
  readonly text: string;
  readonly size: number;
  readonly form: BodyForm;
  readonly base: string | null;
  readonly revision: Revision | null;
} {
  if (!/^text\/|[/+]json\b/.test(request.contentType)) {
    const text = JSON.stringify({ contentType: request.contentType, base64: Buffer.from(request.encoded).toString('base64') });
    return { text, size: Buffer.byteLength(text), form: 'value', base: null, revision: null };
  }
  const text = Buffer.from(request.encoded).toString('utf8');
  if (request.chain === null || !/[/+]json\b/.test(request.contentType))
    return { text, size: Buffer.byteLength(text), form: 'value', base: null, revision: null };
  const document = JSON.parse(text) as unknown;
  if (typeof document !== 'object' || document === null || Array.isArray(document))
    return { text, size: Buffer.byteLength(text), form: 'value', base: null, revision: null };
  const keys = revisionOf(document as Record<string, unknown>);
  const standing = chains.get(request.chain);
  const base = standing !== undefined && standing.bucket === request.bucket && standing.depth < SNAPSHOT_LINKS ? standing : undefined;
  return {
    text: encoded(keys, base),
    size: Buffer.byteLength(JSON.stringify(document)),
    form: base === undefined ? 'full' : 'delta',
    base: base?.id ?? null,
    revision: { id: request.key, bucket: request.bucket, depth: base === undefined ? 0 : base.depth + 1, keys },
  };
}

function attempt<A>(work: () => A): { readonly value: A; readonly failed?: undefined } | { readonly failed: string } {
  try {
    return { value: work() };
  } catch (cause) {
    return { failed: cause instanceof Error ? cause.message : String(cause) };
  }
}

BunRuntime.runMain(main);
