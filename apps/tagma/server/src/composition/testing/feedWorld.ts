import { beforeAll } from 'bun:test';
import type { AppFeed, Reach } from '@runlith/chat-ui/testing/stand/appFeed';
import { markdown, streamChunk } from '@runlith/chat-ui/testing/stand/corpus';
import type { StandGlobal } from '@runlith/chat-ui/testing/stand/port';
import { ready } from '@runlith/chat-ui/testing/stand/scenarios';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { kind, open } from '@runlith/testbed/worlds';
import { Cause, Clock, Context, Effect, Exit, Fiber, Queue, Schema, Stream } from 'effect';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { CDPSession, Page } from 'playwright-core';
import { makeE2eWorld, type E2eOptions, type E2eWorld } from './e2eWorld.js';
import { REPO_ROOT } from './repoRoot.js';

type Served = E2eWorld['Service'];
type Tenant = Effect.Success<Served['tenant']>;
type Models = NonNullable<E2eOptions['models']>;
type Script = Stream.Stream<LLMEvent>;

export const JUMP = 'Jump to latest';

export type Seeding = {
  readonly runs: number;
  readonly entries: number;
  readonly pages: number;
  readonly images: number;
  readonly milliseconds: number;
};

export type Seeded = {
  readonly tenant: Tenant;
  readonly thread: string;
  readonly other: string;
  readonly url: string;
  readonly script: string;
  readonly seeding: Seeding;
  feed: AppFeed;
  next: number;
};

class SeededFeed extends Context.Service<SeededFeed, Seeded>()('stand/SeededFeed') {}

const Entry = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  role: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});
type Entry = typeof Entry.Type;
const Snapshot = Schema.Struct({ snapshot: Schema.Struct({ transcript: Schema.Array(Entry), before: Schema.NullOr(Schema.Int) }) });
const Page = Schema.Struct({ entries: Schema.Array(Entry), before: Schema.NullOr(Schema.Int) });
const Created = Schema.Struct({ block: Schema.Struct({ name: Schema.String }) });
const Roots = Schema.Struct({ blocks: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String })) });

const PAGE_ENTRY = join(REPO_ROOT, 'packages', 'chat-ui', 'stand', 'appPage.ts');
const CROSSING_CHECK = 4;
const OLDER_TURNS = 12;
const label = (index: number): string => `Message ${String(index).padStart(4, '0')}`;
const ASKS = [
  'inspect the next part of this conversation.',
  'compare the measured rows above and below the anchor.',
  'summarize what changed while the reader was away.',
];
const thoughtText = (index: number): string =>
  Array.from(
    { length: 2 + (index % 4) },
    (_, part) => `Thought ${part + 1} on part ${index}: the reader keeps their place while older rows are measured.`,
  ).join('\n\n');

function prompt(index: number): string {
  const ask = `${label(index)}: ${ASKS[index % ASKS.length]}`;
  return index % 11 === 0
    ? `${ask}\n\n${Array.from({ length: 14 }, (_, line) => `Context line ${line + 1} that the composer keeps as the operator wrote it.`).join('\n')}`
    : ask;
}

function answer(index: number, block: string, other: string, last: boolean): string {
  const refs = last || index % 5 === 0 ? `\n\nSee [[${block}]] and [[${other}|the referenced thread]] for the earlier reading.` : '';
  return `${markdown(index)}${refs}`;
}

const events = (thought: string | null, text: string): readonly LLMEvent[] => [
  { type: 'step-start', index: 0 },
  ...(thought === null
    ? []
    : ([
        { type: 'reasoning-start', id: 'thought' },
        { type: 'reasoning-delta', id: 'thought', text: thought },
        { type: 'reasoning-end', id: 'thought' },
      ] satisfies LLMEvent[])),
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text },
  { type: 'text-end', id: 'reply' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop' },
];

const streamed = (pieces: Queue.Queue<string, Cause.Done>): Script =>
  Stream.concat(
    Stream.concat(
      Stream.fromIterable<LLMEvent>([
        { type: 'step-start', index: 0 },
        { type: 'text-start', id: 'reply' },
      ]),
      Stream.map(Stream.fromQueue(pieces), (text): LLMEvent => ({ type: 'text-delta', id: 'reply', text })),
    ),
    Stream.fromIterable<LLMEvent>([
      { type: 'text-end', id: 'reply' },
      { type: 'step-finish', index: 0, reason: 'stop' },
      { type: 'finish', reason: 'stop' },
    ]),
  );

const replying =
  (scripts: Queue.Queue<Script>): Models =>
  (standing) => ({
    ...standing,
    request: (selection) => ({
      system: selection.instructions,
      origin: new ModelIdentity({ provider: ProviderID.make(selection.provider), model: ModelID.make(selection.model ?? 'scripted') }),
      plannedOutputTokens: 32,
      text: () => Effect.die(new Error('the feed corpus answers streamed requests only')),
      object: () => Effect.die(new Error('the feed corpus answers streamed requests only')),
      stream: () => Stream.unwrap(Queue.take(scripts)),
    }),
  });

function png(width: number, height: number): Uint8Array {
  const line = 1 + width * 3;
  const raw = new Uint8Array(line * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) raw.set([32 + (x * 160) / width, 48 + (y * 160) / height, 96], y * line + 1 + x * 3);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 2], 8);
  return Buffer.concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

function walk(entries: readonly Entry[], held: AppFeed | null): AppFeed {
  const labels: Record<string, string> = { ...held?.labels };
  const kinds: Record<string, string> = { ...held?.kinds };
  let current = entries[0] === undefined ? null : (labels[entries[0].id] ?? null);
  for (const entry of entries) {
    const own = entry.role === 'user' ? (entry.text?.match(/^Message \d+/)?.[0] ?? null) : null;
    if (own !== null) current = own;
    kinds[entry.id] = entry.role ?? entry.type;
    if (current === null) continue;
    labels[entry.id] = current;
    if (entry.runId !== undefined) labels[entry.runId] ??= current;
  }
  const newest = entries.at(-1)?.id ?? held?.newest;
  if (newest === undefined) throw new Error('The seeded thread read back no entries');
  return { labels, kinds, newest, head: held?.head ?? label(1), opening: false, jump: JUMP };
}

const latest = Effect.fnUntraced(function* (tenant: Tenant, thread: string) {
  return (yield* Schema.decodeUnknownEffect(Snapshot)(yield* tenant.perform('read_thread_snapshot', { threadId: thread }))).snapshot;
});

const history = Effect.fnUntraced(function* (tenant: Tenant, thread: string) {
  const first = yield* latest(tenant, thread);
  const pages: (readonly Entry[])[] = [first.transcript];
  for (let before = first.before; before !== null;) {
    const page = yield* Schema.decodeUnknownEffect(Page)(yield* tenant.perform('read_thread_entries', { threadId: thread, before }));
    pages.unshift(page.entries);
    before = page.before;
  }
  return { entries: pages.flat(), pages: pages.length };
});

const bundled = Effect.fnUntraced(function* () {
  const built = yield* Effect.promise(() => Bun.build({ entrypoints: [PAGE_ENTRY], format: 'iife', target: 'browser' }));
  const output = built.outputs[0];
  if (!built.success || output === undefined)
    return yield* Effect.die(new AggregateError(built.logs, 'The app lane page entry did not bundle'));
  return yield* Effect.promise(() => output.text());
});

const seed = Effect.fnUntraced(function* () {
  const served = yield* Effect.scoped(makeE2eWorld());
  const tenant = yield* served.tenant;
  const thread = yield* tenant.thread({ title: 'Feed corpus' });
  const other = yield* tenant.thread({ title: 'Referenced thread' });
  const roots = yield* Schema.decodeUnknownEffect(Roots)(yield* tenant.perform('list_root_blocks', {}));
  const { block } = yield* Schema.decodeUnknownEffect(Created)(
    yield* tenant.perform('create_block', { title: 'Feed reference block', parentId: roots.blocks[0].name }),
  );
  const scripts = yield* Queue.unbounded<Script>();
  const image = png(640, 360);
  const started = yield* Clock.currentTimeMillis;
  let images = 0;
  let runs = 0;
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* served.world.lend({ models: replying(scripts) });
      yield* Queue.offer(scripts, Stream.fromIterable(events(null, `This thread is cited from [[${thread.id}|the feed corpus]].`)));
      yield* tenant.turn(other.id, { key: 'referenced-1', text: 'Point back to the feed corpus.' });
      let first: string | undefined;
      let crossed: number | null = null;
      for (let index = 1; crossed === null || index <= crossed + OLDER_TURNS; index += 1) {
        const last = crossed !== null && index === crossed + OLDER_TURNS;
        const attachments = index % 7 === 0 ? [yield* tenant.upload(thread.id, image, 'image/png', `chart-${index}.png`)] : undefined;
        if (attachments !== undefined) images += 1;
        yield* Queue.offer(
          scripts,
          Stream.fromIterable(events(index % 2 === 0 ? thoughtText(index) : null, answer(index, block.name, other.id, last))),
        );
        const { runId } = yield* tenant.turn(thread.id, { key: `feed-${index}`, text: prompt(index), attachments });
        first ??= runId;
        runs = index;
        if (crossed === null && index % CROSSING_CHECK === 0 && (yield* latest(tenant, thread.id)).before !== null) crossed = index;
      }
      yield* Queue.offer(scripts, Stream.fromIterable(events(null, 'A replayed key must not start this run.')));
      const replayed = yield* tenant.turn(thread.id, { key: 'feed-1', text: prompt(1) });
      if (replayed.runId !== first)
        return yield* Effect.die(new Error(`Replaying key feed-1 answered run ${replayed.runId}, not its original run ${first}`));
    }),
  );
  const read = yield* history(tenant, thread.id);
  const milliseconds = (yield* Clock.currentTimeMillis) - started;
  return SeededFeed.of({
    tenant,
    thread: thread.id,
    other: other.id,
    url: `${served.origin}/${encodeURIComponent(tenant.projectName)}/chat/${thread.id}`,
    script: yield* bundled(),
    seeding: { runs, entries: read.entries.length, pages: read.pages, images, milliseconds },
    feed: walk(read.entries, null),
    next: runs + 1,
  });
});

const seededFeed = kind(SeededFeed, () => seed());

export function appFeed(): () => Seeded {
  let held: Seeded | undefined;
  beforeAll(async () => {
    held = await open(seededFeed, null);
    console.log(JSON.stringify({ seeding: held.seeding }));
  });
  return () => {
    if (held === undefined) throw new Error('The seeded thread is read before its build hook');
    return held;
  };
}

type Ask = { readonly act: Effect.Effect<unknown, unknown>; readonly settle: (exit: Exit.Exit<unknown, unknown>) => void };

const frames = (page: Page, count: number) =>
  Effect.promise(() => page.evaluate((count) => (globalThis as StandGlobal).feedStand!.frames(count), count));

export const visit = Effect.fnUntraced(function* (
  page: Page,
  cdp: CDPSession | undefined,
  seeded: Seeded,
  options: { readonly opening: boolean },
) {
  const scripts = yield* Queue.unbounded<Script>();
  yield* makeE2eWorld({ models: replying(scripts) });
  let requested = 0;
  let holding = false;
  const held: (() => void)[] = [];
  yield* Effect.promise(() =>
    page.routeWebSocket(/.*/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        if (typeof message === 'string' && message.includes('thread.entries')) requested += 1;
        server.send(message);
      });
      server.onMessage((message) => (holding ? held.push(() => socket.send(message)) : socket.send(message)));
    }),
  );
  const asks = yield* Queue.unbounded<Ask>();
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.flatMap(Queue.take(asks), (ask) => Effect.flatMap(Effect.exit(ask.act), (exit) => Effect.sync(() => ask.settle(exit)))),
    ),
  );
  const expose = <A extends unknown[], B, E>(name: string, act: (...args: A) => Effect.Effect<B, E>) =>
    Effect.promise(() =>
      page.exposeFunction(
        name,
        (...args: A) =>
          new Promise<unknown>((resolve, reject) => {
            Queue.offerUnsafe(asks, {
              act: act(...args),
              settle: (exit) => (Exit.isSuccess(exit) ? resolve(exit.value) : reject(Cause.squash(exit.cause))),
            });
          }),
      ),
    );
  const click = (thread: string) => Effect.promise(() => page.locator(`a[href*="${thread}"]:visible`).first().click());
  yield* expose(
    'feedAppStream',
    Effect.fnUntraced(function* (chunks: number) {
      const index = seeded.next;
      seeded.next += 1;
      const pieces = yield* Queue.unbounded<string, Cause.Done>();
      yield* Queue.offer(scripts, streamed(pieces));
      const turn = yield* Effect.forkChild(
        seeded.tenant.turn(seeded.thread, { key: `stream-${index}`, text: `${label(index)}: stream the next answer while I read above.` }),
      );
      for (let chunk = 0; chunk < chunks; chunk += 1) {
        yield* frames(page, 2);
        yield* Queue.offer(pieces, streamChunk(chunk));
      }
      yield* Queue.end(pieces);
      yield* Fiber.join(turn);
      seeded.feed = walk((yield* latest(seeded.tenant, seeded.thread)).transcript, seeded.feed);
      return seeded.feed;
    }),
  );
  yield* expose('feedAppResize', (width: number, height: number) => Effect.promise(() => page.setViewportSize({ width, height })));
  yield* expose(
    'feedAppLeave',
    Effect.fnUntraced(function* () {
      yield* click(seeded.other);
      yield* Effect.promise(() => page.locator(`[data-timeline-key="${seeded.feed.newest}"]`).waitFor({ state: 'detached' }));
    }),
  );
  yield* expose('feedAppReturn', () => click(seeded.thread));
  yield* expose('feedAppPaging', (): Effect.Effect<Reach> => Effect.sync(() => ({ requested })));
  yield* expose('feedAppHoldPages', () =>
    Effect.sync(() => {
      holding = true;
    }),
  );
  yield* expose('feedAppReleasePages', () =>
    Effect.sync(() => {
      holding = false;
      for (const send of held.splice(0)) send();
    }),
  );
  if (cdp !== undefined) yield* Effect.promise(() => cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }));
  yield* Effect.promise(() =>
    page.addInitScript({ content: `window.feedApp = ${JSON.stringify({ ...seeded.feed, opening: options.opening })};\n${seeded.script}` }),
  );
  yield* reopen(page, seeded);
});

export const reopen = (page: Page, seeded: Seeded) =>
  Effect.promise(async () => {
    await page.goto(seeded.url);
    await ready(page);
  });
