import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { assistantMessageEntryId } from '@runlith/agent/transcript/entryNames';
import { test } from 'vitest';
import { builtinEntryKinds } from './builtinKinds';
import { ChatEntryView } from './ChatEntryView.svelte';
import { ChatFold } from './ChatFold.svelte';
import { FeedMemory } from './FeedMemory';
import { type ChatRowView, DESKTOP_METRICS } from './rowEstimate';
import { FeedReader } from './session/FeedReader';
import { at, openEvent, snapshotEvent } from './testing/chatHarness.svelte';
import { TimelineFold } from './TimelineFold';
import { VisibleFeed } from './VisibleFeed';

const kinds = builtinEntryKinds();

const ACTIVE_RUN = 'run-active';
const ENTRIES_PER_RUN = 7;
const SAMPLES = 40;
const WARMUP = 20;
const TARGET = 2;

type Mode = 'grow' | 'prepend' | 'withdraw';
type Scale = { history: number; live: number; body: number; rewound: boolean; mode: Mode };
const SMALL: Scale = { history: 100, live: 1, body: 100, rewound: false, mode: 'grow' };
const LARGE_HISTORY: Scale = { ...SMALL, history: 10_000 };
const LARGE_REWOUND: Scale = { ...SMALL, history: 10_000, rewound: true };
const LARGE_LIVE: Scale = { ...SMALL, live: 200 };
const LARGE_BODY: Scale = { ...SMALL, body: 100_000 };

const view: ChatRowView = {
  metrics: DESKTOP_METRICS,
  expanded: (_key, fallback) => fallback,
  stretchDefault: (_key, newest) => newest,
  toolOpen: () => undefined,
};

function settledRun(index: number, rewound: boolean): ThreadTranscriptEntry[] {
  const runId = `run-${index}`;
  const at = new Date(Date.UTC(2026, 0, 1 + Math.floor(index / 40), 0, index % 60)).toISOString();
  const tool = (call: number): ThreadTranscriptEntry =>
    ({
      type: 'tool',
      id: `tool:${runId}:${call}`,
      runId,
      occurredAt: at,
      toolName: call === 1 ? 'bash' : 'read',
      toolCallId: `${runId}:${call}`,
      toolState: 'output-available',
      toolInput: { path: `src/file-${call}.ts` },
      toolOutput: 'ok',
    }) as ThreadTranscriptEntry;
  const run = [
    { type: 'message', id: `user:${runId}`, role: 'user', runId, occurredAt: at, text: `Question number ${index} about the code` },
    { type: 'reasoning', id: `reasoning:${runId}`, runId, occurredAt: at, text: 'Thinking about the next step.', state: 'done' },
    tool(0),
    tool(1),
    tool(2),
    {
      type: 'message',
      id: `assistant:${runId}`,
      role: 'assistant',
      runId,
      occurredAt: at,
      text: `Answer ${index} with **markdown** body.`,
    },
    { type: 'run-end', id: `run-end:${runId}`, runId, status: 'completed', startedAt: at, finishedAt: at, occurredAt: at },
  ] as ThreadTranscriptEntry[];
  const by = index % 5 === 1 ? 'rw-a' : index % 11 === 3 ? 'rw-b' : null;
  return rewound && by !== null ? run.map((entry) => ({ ...entry, rewound: { by, scope: 'from' } }) as ThreadTranscriptEntry) : run;
}

function prose(length: number): string {
  const line = 'a line of prose that the answer carries along with it, '.repeat(2);
  let text = '';
  while (text.length < length) text += `${line}\n`;
  return text.slice(0, length);
}

type Chain = {
  readonly prepare: (step: number) => void;
  readonly patch: (step: number) => void;
  readonly read: () => number;
};

const ANSWER_ID = assistantMessageEntryId(ACTIVE_RUN, 0);
const PAGE_RUNS = 3;
const PENDING_ROWS = SAMPLES + WARMUP + 1;

function pageOf(step: number): ThreadTranscriptEntry[] {
  return Array.from({ length: PAGE_RUNS }, (_unused, run) => {
    const runId = `page-${step}-${run}`;
    return [
      { type: 'message', id: `user:${runId}`, role: 'user', text: 'Older question', runId },
      { type: 'message', id: `assistant:${runId}`, role: 'assistant', text: 'Older answer', runId },
    ] as ThreadTranscriptEntry[];
  }).flat();
}

function chainOf(scale: Scale): Chain {
  const total = SAMPLES + WARMUP + 1;
  const runs = Math.max(1, Math.floor(scale.history / ENTRIES_PER_RUN));
  const transcript: ThreadTranscriptEntry[] = [];
  for (let index = 0; index < runs; index += 1) transcript.push(...settledRun(index, scale.rewound));
  transcript.push({
    type: 'message',
    id: `user:${ACTIVE_RUN}`,
    role: 'user',
    runId: ACTIVE_RUN,
    occurredAt: '2026-03-01T00:00:00.000Z',
    text: 'Now the live question',
  } as ThreadTranscriptEntry);
  transcript.splice(Math.floor(transcript.length / 2), 0, {
    type: 'ready-answers',
    id: 'ready:bench',
    runId: 'run-0',
    answers: [{ label: 'Yes', send: 'yes' }],
  } as unknown as ThreadTranscriptEntry);
  const store = new ChatFold();
  const surface = new ChatEntryView(new FeedMemory({}), {
    fold: () => store,
    copyText: async () => true,
    copyImage: async () => true,
    saveImage: async () => {},
    verbose: { read: () => false, write: () => undefined },
    stretches: { read: () => 'newest', write: () => undefined },
    disclosure: { read: () => ({}), write: () => undefined },
  });
  const pending =
    scale.mode === 'withdraw'
      ? Array.from(
          { length: PENDING_ROWS },
          (_unused, at) => store.beginUserMessage({ text: `Waiting ${at}`, turnKey: `turn-${at}` }).anchorId!,
        )
      : [];
  const answer = {
    type: 'message',
    id: ANSWER_ID,
    role: 'assistant',
    runId: ACTIVE_RUN,
    text: prose(scale.body),
  } as ThreadTranscriptEntry;
  const open = [
    ...Array.from({ length: scale.live }, (_unused, call) => ({
      type: 'tool',
      id: `tool:${ACTIVE_RUN}:${call}`,
      runId: ACTIVE_RUN,
      toolName: 'read',
      toolCallId: `${ACTIVE_RUN}:${call}`,
      toolState: 'input-streaming',
      toolInputRaw: { kind: 'text', text: `{"path":"src/live-${call}.ts"`, complete: false },
    })),
    answer,
  ] as ThreadTranscriptEntry[];
  const reader = new FeedReader(store);
  reader.read(snapshotEvent({ activeRunId: ACTIVE_RUN, transcript, open }));
  let seq = 1;
  const feed = new VisibleFeed(kinds);
  const rows = new TimelineFold(kinds);
  const sync = () => {
    feed.sync(store, false, run);
    rows.sync(feed, view, { runId: ACTIVE_RUN, status: true }, []);
  };
  sync();
  return {
    prepare(step) {
      if (scale.mode === 'prepend') store.prepend(pageOf(step), null);
    },
    patch(step) {
      if (scale.mode === 'withdraw') store.retireUserMessage(pending[step]!);
      else if (scale.mode === 'grow') {
        seq += 1;
        reader.read(openEvent({ op: 'append', id: ANSWER_ID, text: `${step % 7 === 0 ? '\n' : ' '}token${step}` }, at(1, seq)));
      }
      sync();
    },
    read() {
      const last = rows.count - 1;
      return (
        rows.count +
        (surface.readyAnswerPick('ready:bench') ?? 0) +
        (rows.keyAt(last)?.length ?? 0) +
        (rows.itemAt(rows.indexOf(ANSWER_ID))?.estimate ?? 0)
      );
    },
  };
}

const run = { id: ACTIVE_RUN, phase: 'working' as const };

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[sorted.length >> 1]!;
}

function ratio(large: Scale): number {
  const small = chainOf(SMALL.mode === large.mode ? SMALL : { ...SMALL, mode: large.mode });
  const big = chainOf(large);
  let sink = 0;
  const timed = (chain: Chain, step: number): number => {
    chain.prepare(step);
    const started = process.hrtime.bigint();
    chain.patch(step);
    sink += chain.read();
    return Number(process.hrtime.bigint() - started);
  };
  for (let step = 1; step <= WARMUP; step += 1) {
    timed(small, step);
    timed(big, step);
  }
  const smalls: number[] = [];
  const bigs: number[] = [];
  for (let step = WARMUP + 1; step <= WARMUP + SAMPLES; step += 1) {
    smalls.push(timed(small, step));
    bigs.push(timed(big, step));
  }
  if (sink <= 0) throw new Error('the patched feed read nothing back, so the timings measured no work');
  return medianOf(bigs) / medianOf(smalls);
}

const SCENARIOS: readonly (readonly [string, Scale])[] = [
  ['history of 100 and 10 000 entries', LARGE_HISTORY],
  ['the same history holding rewound turns', LARGE_REWOUND],
  ['beside 1 and 200 live parts of the run', LARGE_LIVE],
  ['a body of 100 and 100 000 characters', LARGE_BODY],
  ['a page landing above, 100 and 10 000 entries', { ...LARGE_HISTORY, mode: 'prepend' }],
  ['a row withdrawn near the top, 100 and 10 000 entries', { ...LARGE_HISTORY, mode: 'withdraw' }],
];

test('the median cost of one patch at the large scale over the small one', () => {
  console.table(SCENARIOS.map(([scenario, scale]) => ({ scenario, ratio: Number(ratio(scale).toFixed(2)), target: TARGET })));
});
