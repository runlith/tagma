import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { describe, expect, test } from 'vitest';
import {
  type ActivityGroup,
  activityRows,
  chatToolActivityLine,
  foldedToolCounts,
  groupDurationSeconds,
  groupFailureCount,
  readableOutput,
  type ToolActivityEntry,
  toolCancelled,
  toolOperationRefused,
  toolOpensByDefault,
  toolOutcomeUnknown,
  toolRefusalWord,
  toolSettled,
  toolFailed,
} from './activity';
import type { ThreadSignalEntry } from '@runlith/agent/transcript/entries';
import type { ChatEntry } from './entries';
import { entryFromTranscript } from './entryProjection';
import { chatTimeline } from './TimelineFold';
import { visibleChatEntries } from './VisibleFeed';
import { builtinEntryKinds } from './builtinKinds';

const kinds = builtinEntryKinds();

const user = (id: string, runId?: string, occurredAt?: string): ChatEntry => ({
  id,
  kind: 'user',
  text: 'question',
  runId,
  occurredAt,
});
const assistant = (id: string, runId = 'run-1', occurredAt?: string): ChatEntry => ({
  id,
  kind: 'assistant',
  text: 'answer',
  runId,
  occurredAt,
});
const reasoning = (id: string, runId = 'run-1'): ChatEntry => ({
  id,
  kind: 'reasoning',
  text: 'thinking through the plan',
  runId,
});
const tool = (id: string, extra?: Partial<Extract<ChatEntry, { kind: 'tool' }>>): ChatEntry => ({
  id,
  kind: 'tool',
  toolName: 'save_sprint_items',
  toolCallId: id,
  toolState: 'output-available',
  runId: 'run-1',
  ...extra,
});
const systemPrompt = (id: string): ChatEntry => ({ id, kind: 'system-prompt', text: 'prompt', runId: 'run-1' });
const signal = (
  id: string,
  addressee: 'reader' | 'transport',
  runId = 'run-1',
  extra?: Partial<Extract<ChatEntry, { kind: 'signal' }>>,
): ChatEntry => ({
  id,
  kind: 'signal',
  signalType: 'any-type',
  addressee,
  text: 'notice',
  runId,
  ...extra,
});
const guidance = (id: string, runId = 'run-1'): ChatEntry => ({
  id,
  kind: 'runtime-guidance',
  runId,
  runtimeGuidance: {
    type: 'runtime-guidance',
    id,
    runId,
    hook: 'beforeStep',
    sequence: 1,
    texts: ['note'],
    sources: [],
  },
});

function activityGroup(entries: readonly ChatEntry[]): ActivityGroup {
  const item = chatTimeline(kinds, entries).find((candidate) => candidate.kind === 'stretch');
  if (!item || item.kind !== 'stretch') throw new Error('expected a stretch');
  return item.group;
}

describe('verbose visibility', () => {
  test('hides run-context and guidance kinds unless verbose, keeps tools and reasoning always', () => {
    const entries = [systemPrompt('s1'), user('u1', 'run-1'), tool('t1'), guidance('g1'), reasoning('r1'), assistant('a1')];

    expect(visibleChatEntries(kinds, entries, false).map((entry) => entry.id)).toEqual(['u1', 't1', 'r1', 'a1']);
    expect(visibleChatEntries(kinds, entries, true).map((entry) => entry.id)).toEqual(['s1', 'u1', 't1', 'g1', 'r1', 'a1']);
  });

  test('read words from the operator and from agents stand as words with their sender and its home; machinery signals stay verbose', () => {
    const said = (id: string, entry: Partial<ThreadSignalEntry>) =>
      entryFromTranscript({ type: 'signal', id, runId: 'run-1', signalType: 'message', addressee: 'transport', text: id, ...entry });
    const entries = [
      ...said('steer', { addressee: 'reader', signalType: 'user-message' }),
      ...said('task', { signalType: 'task', title: 'lead', senderThreadId: 'thread-lead', senderProjectId: 39 }),
      ...said('report', { signalType: 'report', title: 'child', senderThreadId: 'thread-child', unconfirmed: true }),
      ...said('notice', { signalType: 'tool-result' }),
      assistant('a1'),
    ];

    expect(visibleChatEntries(kinds, entries, false)).toMatchObject([
      { id: 'steer', kind: 'words', intent: 'user-message', sender: null },
      { id: 'task', kind: 'words', intent: 'task', sender: { name: 'lead', threadId: 'thread-lead', projectId: 39 } },
      { id: 'report', kind: 'words', intent: 'report', sender: { name: 'child', threadId: 'thread-child' }, unconfirmed: true },
      { id: 'a1' },
    ]);
    expect(visibleChatEntries(kinds, entries, true).map((entry) => entry.id)).toEqual(['steer', 'task', 'report', 'notice', 'a1']);
  });

  test('a keep-warm ping stands in the feed carrying its run ending’s spend and account; the ending leaves, and its answer shows only verbose', () => {
    const ending = (runId: string, extra: object = {}): ChatEntry => ({
      kind: 'run-end',
      id: `end-${runId}`,
      runId,
      status: 'completed',
      startedAt: '2026-09-25T10:00:00Z',
      finishedAt: '2026-09-25T10:00:02Z',
      occurredAt: '2026-09-25T10:00:02Z',
      ...extra,
    });
    const entries = [
      assistant('a1', 'run-1'),
      ending('run-1'),
      signal('ping', 'transport', 'run-2', { signalType: KEEP_WARM_SIGNAL_TYPE }),
      assistant('ok', 'run-2'),
      ending('run-2', { usage: { cacheReadInputTokens: 712_000, cacheWriteInputTokens: 40 }, account: 'acct-1' }),
    ];

    const shown = visibleChatEntries(kinds, entries, false);
    expect(shown.map((entry) => entry.id)).toEqual(['a1', 'end-run-1', 'ping']);
    expect(visibleChatEntries(kinds, entries, true).map((entry) => entry.id)).toEqual(['a1', 'end-run-1', 'ping', 'ok']);
    expect(shown[2]).toMatchObject({
      keptWarm: { status: 'completed', usage: { cacheReadInputTokens: 712_000 }, account: 'acct-1' },
    });
  });
});

describe('tool step status', () => {
  test('reads failure from the producer’s settled state, never from the output', () => {
    const failing = tool('t1', { toolState: 'output-error' });
    if (failing.kind !== 'tool') throw new Error('expected tool entry');
    expect(toolFailed(failing)).toBe(true);

    const succeeded = tool('t5', { toolOutput: { status: 'rejected', accepted: false } });
    if (succeeded.kind !== 'tool') throw new Error('expected tool entry');
    expect(toolFailed(succeeded)).toBe(false);
  });

  test('an outcome nobody knows is neither a failure nor a step that may fold away', () => {
    const unknown = tool('t1', { toolState: 'output-unknown' });
    const twin = tool('t2', { toolState: 'output-unknown' });
    if (unknown.kind !== 'tool') throw new Error('expected tool entry');
    expect(toolOutcomeUnknown(unknown)).toBe(true);
    expect(toolFailed(unknown)).toBe(false);
    expect(groupFailureCount(activityGroup([unknown, twin]))).toBe(0);
    const withDisplay = (entry: ChatEntry): ChatEntry => ({ ...entry, display: { form: 'none', title: 'a.ts' } }) as ChatEntry;
    const rows = activityRows([withDisplay(unknown), withDisplay(twin)] as ToolActivityEntry[]);
    expect(rows.map((row) => row.kind)).toEqual(['step', 'step']);
  });

  test('keeps a denied tool distinct from success and execution failure', () => {
    const cancelled = tool('t6', { toolState: 'output-denied' });
    if (cancelled.kind !== 'tool') throw new Error('expected tool entry');

    expect(toolCancelled(cancelled)).toBe(true);
    expect(toolFailed(cancelled)).toBe(false);
  });

  test('keeps a refused call distinct from success and from failure', () => {
    const refused = tool('t9', { toolState: 'output-refused', toolRefusal: { code: 'busy', reason: 'held' } });
    if (refused.kind !== 'tool') throw new Error('expected tool entry');

    expect(toolOperationRefused(refused)).toBe(true);
    expect(toolSettled(refused)).toBe(true);
    expect(toolCancelled(refused)).toBe(false);
    expect(toolFailed(refused)).toBe(false);
    expect(groupFailureCount(activityGroup([refused, tool('t10')]))).toBe(0);
  });

  test('a refused call stays shut even when its display asks to open, while a broken one opens', () => {
    const opening: ToolDisplay = { form: 'text', text: 'refused[rule-violated]: …', opens: true };
    const refused = tool('t11', { toolState: 'output-refused', toolRefusal: { code: 'rule-violated', reason: 'r' }, display: opening });
    const broken = tool('t12', { toolState: 'output-error', toolError: 'the server broke' });
    if (refused.kind !== 'tool' || broken.kind !== 'tool') throw new Error('expected tool entries');

    expect(toolOpensByDefault(refused, true)).toBe(false);
    expect(toolOpensByDefault(broken, false)).toBe(true);
  });

  test('a refused call says its producer’s words once: a producer fact that already says them takes their place', () => {
    const read = tool('t13', { toolState: 'output-refused', toolRefusal: { code: 'not-found', reason: 'no file', words: 'Not found' } });
    const unsaid = tool('t17', { toolState: 'output-refused', toolRefusal: { code: 'not-found', reason: 'no file' } });
    const missed = tool('t16', {
      toolState: 'output-refused',
      toolRefusal: { code: 'not-found', reason: 'no file', words: 'Not found' },
      display: { form: 'text', text: 'no file', facts: [{ label: 'Not found', value: 'missing.ts' }] },
    });
    const ran = tool('t14', {
      toolState: 'output-refused',
      toolRefusal: { code: 'exit', reason: 'Command exited with status 1.' },
      display: { form: 'none', facts: [{ label: 'exit', value: '1' }] },
    });
    const stored = tool('t15', {
      toolState: 'output-refused',
      toolRefusal: { code: 'rule-violated', reason: 'r' },
      display: { form: 'text', text: 'r', facts: [{ label: 'refused', value: 'rule-violated' }] },
    });
    if (read.kind !== 'tool' || unsaid.kind !== 'tool' || ran.kind !== 'tool' || stored.kind !== 'tool' || missed.kind !== 'tool')
      throw new Error('expected tool entries');

    expect(toolRefusalWord(read, 'Refused')).toBe('Not found');
    expect(toolRefusalWord(unsaid, 'Refused')).toBe('Refused');
    expect(toolRefusalWord(missed, 'Refused')).toBeNull();
    expect(toolRefusalWord(ran, 'Refused')).toBeNull();
    expect(toolRefusalWord(stored, 'Refused')).toBeNull();
  });

  test('counts failed tool steps per group, ignoring reasoning', () => {
    const group = activityGroup([tool('t1'), reasoning('r1'), tool('t2', { toolState: 'output-error' })]);
    expect(groupFailureCount(group)).toBe(1);
  });
});

test('an answered call with no display body reads through its tool text, and a failed one does not', () => {
  const text = (_name: string, output: unknown) => (typeof output === 'string' ? output : null);
  const answered = tool('t1', { display: { form: 'none', title: 'threads' }, toolOutput: 'thread-1 · working' });
  const failed = tool('t2', { toolState: 'output-error', toolOutput: 'thread-1 · working' });
  const shown = tool('t3', { display: { form: 'text', text: 'shown' }, toolOutput: 'thread-1 · working' });
  expect(readableOutput(answered as ToolActivityEntry, text)).toBe('thread-1 · working');
  expect(readableOutput(failed as ToolActivityEntry, text)).toBeNull();
  expect(readableOutput(shown as ToolActivityEntry, text)).toBeNull();
});

describe('a call that carries two acts under one name', () => {
  const words = {
    livePhase: (phase: string) => `phase:${phase}`,
    toolRunning: (toolName: string) => `Running ${toolName}`,
    toolRunningAlone: () => null,
    toolDone: (toolName: string) => `Ran ${toolName}`,
    toolDoneAlone: () => null,
    toolUnknown: (toolName: string) => toolName,
  };

  test('reads as the act its form declared, not as the word for its tool name', () => {
    const brought = { toolName: 'archive_thread', state: 'done', title: 't1', verb: 'Brought a thread back' } as const;
    expect(chatToolActivityLine(brought, words)).toEqual({ lead: 'Brought a thread back', subject: 't1', join: 'phrase' });
    expect(chatToolActivityLine({ toolName: 'archive_thread', state: 'done', title: 't1' }, words)).toEqual({
      lead: 'Ran archive_thread',
      subject: 't1',
      join: 'phrase',
    });
  });
});

describe('a call that has named nothing', () => {
  const words = {
    toolRunning: (toolName: string) => `Running ${toolName}`,
    toolRunningAlone: (toolName: string) => `Unnamed ${toolName}`,
    toolDone: (toolName: string) => `Ran ${toolName}`,
    toolDoneAlone: (toolName: string) => `Ran an unnamed ${toolName}`,
    toolUnknown: (toolName: string) => toolName,
  };
  const wholePhraseAlready = { ...words, toolRunningAlone: () => null, toolDoneAlone: () => null };

  test('a finished call takes the words written to stand alone, as a running one does', () => {
    expect(chatToolActivityLine({ toolName: 'send_message', state: 'done', title: null }, words)).toEqual({
      lead: 'Ran an unnamed send_message',
      subject: null,
      join: 'phrase',
    });
    expect(chatToolActivityLine({ toolName: 'list_agents', state: 'done', title: null }, wholePhraseAlready).lead).toBe('Ran list_agents');
  });

  test('asks for the words written to stand alone, and keeps them when the tool answers none', () => {
    expect(chatToolActivityLine({ toolName: 'write', state: 'running', title: null }, words)).toEqual({
      lead: 'Unnamed write',
      subject: null,
      join: 'phrase',
    });
    expect(chatToolActivityLine({ toolName: 'list_agents', state: 'running', title: null }, wholePhraseAlready)).toEqual({
      lead: 'Running list_agents',
      subject: null,
      join: 'phrase',
    });
  });

  test('a call that named itself keeps the words its subject continues', () => {
    expect(chatToolActivityLine({ toolName: 'write', state: 'running', title: 'notes.md' }, words)).toEqual({
      lead: 'Running write',
      subject: 'notes.md',
      join: 'phrase',
    });
  });

  test('a title its tool wrote to stand alone takes no tool words, but a declared verb still leads it', () => {
    const said = { toolName: 'bash', state: 'done', title: 'Run the tests', alone: true } as const;
    expect(chatToolActivityLine(said, words)).toEqual({ lead: null, subject: 'Run the tests', join: 'phrase' });
    expect(chatToolActivityLine({ ...said, verb: 'Left running' }, words).lead).toBe('Left running');
  });
});

describe('group duration', () => {
  test('spans the persisted timestamps and rounds to seconds', () => {
    const group = activityGroup([
      tool('t1', { occurredAt: '2026-07-06T16:55:00.000Z' }),
      tool('t2', { occurredAt: '2026-07-06T16:55:24.400Z' }),
    ]);
    expect(groupDurationSeconds(group)).toBe(24);
  });

  test('projects to null without two timestamps or below one second', () => {
    expect(groupDurationSeconds(activityGroup([tool('t1'), tool('t2')]))).toBeNull();
    expect(
      groupDurationSeconds(
        activityGroup([tool('t1', { occurredAt: '2026-07-06T16:55:00.000Z' }), tool('t2', { occurredAt: '2026-07-06T16:55:00.400Z' })]),
      ),
    ).toBeNull();
  });
});

describe('activityRows', () => {
  const settled = (id: string, toolName: string, display: ToolDisplay): ToolActivityEntry => ({
    id,
    kind: 'tool',
    runId: 'run-1',
    toolName,
    toolCallId: id,
    toolState: 'output-available',
    display,
  });
  const read = (id: string) => settled(id, 'read', { form: 'code', text: 'const a = 1', title: `${id}.ts` });
  const search = (id: string) => settled(id, 'grep', { form: 'list', items: [{ label: 'a.ts:1' }] });
  const wrote = (id: string) =>
    settled(id, 'write', { form: 'diff', files: [{ path: 'a.ts', patch: '+a', added: 1, removed: 0 }], mutates: true });
  const ran = (id: string) => settled(id, 'bash', { form: 'text', text: 'ok', mutates: true });

  const fetched = (id: string) => settled(id, 'webfetch', { form: 'markdown', text: '# Page', title: `https://${id}.dev` });
  const told = (id: string) => settled(id, 'send_task', { form: 'message', text: 'Do it.', title: 'api' });

  test('three reading calls in a row fold, mixed; two stay rows, and the first change breaks the run', () => {
    const rows = activityRows([read('a'), fetched('b'), search('c'), wrote('d'), read('e'), read('f')]);
    expect(rows.map((row) => row.kind)).toEqual(['folded', 'step', 'step', 'step']);
    expect(rows[0]?.kind === 'folded' && rows[0].entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(rows[1]?.kind === 'step' && rows[1].entry.id).toBe('d');
  });

  test('a run still growing stays row by row and folds once the turn is over', () => {
    const run = [read('a'), read('b'), search('c')];
    expect(activityRows(run, { growing: true }).map((row) => row.kind)).toEqual(['step', 'step', 'step']);
    expect(activityRows(run).map((row) => row.kind)).toEqual(['folded']);
  });

  test('a call that mutates or speaks to an agent never folds, whatever form it answered', () => {
    expect(activityRows([ran('a'), ran('b'), ran('c')]).map((row) => row.kind)).toEqual(['step', 'step', 'step']);
    expect(activityRows([told('a'), told('b'), told('c')]).map((row) => row.kind)).toEqual(['step', 'step', 'step']);
  });

  test('binary activities keep each file summary as its own row', () => {
    const entries = ['a', 'b'].map((id) => settled(id, 'read', { form: 'binary', path: `${id}.dat`, byteLength: 12 }));
    const rows = activityRows(entries);
    expect(rows.map((row) => row.kind)).toEqual(['step', 'step']);
    expect(rows.map((row) => row.kind === 'step' && row.entry)).toEqual(entries);
  });

  test('a call whose view is kept alive never folds into a count', () => {
    const rows = activityRows([read('a'), read('b'), read('c')], { keepsAlive: (entry) => entry.id === 'b' });
    expect(rows.map((row) => row.kind)).toEqual(['step', 'step', 'step']);
  });

  test('one foldable call stays its own step, and its counts group by tool', () => {
    expect(activityRows([read('a')]).map((row) => row.kind)).toEqual(['step']);
    expect(foldedToolCounts([read('a'), read('b'), search('c')])).toEqual([
      { name: 'read', count: 2 },
      { name: 'grep', count: 1 },
    ]);
  });

  test('a failed call breaks the fold: its message is an answer, not material', () => {
    const failed: ToolActivityEntry = { ...read('x'), toolState: 'output-error', toolError: 'boom' };
    expect(activityRows([read('a'), failed, read('c')]).map((row) => row.kind)).toEqual(['step', 'step', 'step']);
  });

  const label = (id: string, name: string): Extract<ChatEntry, { kind: 'reasoning' }> => ({
    id,
    kind: 'reasoning',
    runId: 'run-1',
    text: `**${name}**`,
  });

  test('consecutive named thoughts fold into one counted row', () => {
    const rows = activityRows([label('a', 'Planning the probe'), label('b', 'Weighing the load test')]);
    expect(rows.map((row) => row.kind)).toEqual(['thoughts']);
    expect(rows[0]?.kind === 'thoughts' && rows[0].entries.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  test('a call between two thoughts keeps them apart, and a lone thought is its own step', () => {
    expect(activityRows([label('a', 'One'), read('b'), label('c', 'Two')]).map((row) => row.kind)).toEqual(['step', 'step', 'step']);
  });

  test('a thought with a body under its name never folds', () => {
    const bodied: Extract<ChatEntry, { kind: 'reasoning' }> = {
      id: 'a',
      kind: 'reasoning',
      runId: 'run-1',
      text: '**Weighing the options**\n\nThe first one costs a rewrite of the loader.',
    };
    expect(activityRows([bodied, label('b', 'Then this')]).map((row) => row.kind)).toEqual(['step', 'step']);
  });

  test('a thought still streaming stays a row of its own', () => {
    const live: Extract<ChatEntry, { kind: 'reasoning' }> = {
      ...label('a', 'Starting out'),
      reasoningState: 'streaming',
    };
    expect(activityRows([live, label('b', 'And this')]).map((row) => row.kind)).toEqual(['step', 'step']);
  });
});
