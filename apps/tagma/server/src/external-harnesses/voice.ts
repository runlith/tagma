import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { HarnessTransport } from '../threads/contract/wire/harness/names.js';

type Spoken = { readonly threadId: string; readonly runId: string; readonly queued: boolean };

type Screen = { readonly threadId: string; readonly screenText: string };

type Moved = { readonly status: 'switched' | 'unchanged'; readonly threadId: string; readonly transport: HarnessTransport };

export const spokenText = (answer: Spoken): string =>
  answer.queued
    ? `queued: the CLI of ${answer.threadId} reads these words next (run ${answer.runId})`
    : `spoken: the CLI of ${answer.threadId} takes these words in run ${answer.runId}`;

export const spokenDisplay = (answer: Spoken): ToolDisplay => ({
  form: 'none',
  mutates: true,
  title: answer.threadId,
  facts: answer.queued ? [{ label: 'run', value: 'queued' }] : undefined,
  details: [{ label: answer.queued ? 'queued for run' : 'spoken into run', value: answer.runId }],
});

export const screenText = (answer: Screen): string => (answer.screenText === '' ? '(the screen is blank)' : answer.screenText);

export const screenDisplay = (answer: Screen): ToolDisplay => ({
  form: 'none',
  title: answer.threadId,
  facts: [{ label: 'rows', value: String(answer.screenText === '' ? 0 : answer.screenText.split('\n').length) }],
});

export const movedText = (answer: Moved): string =>
  answer.status === 'switched'
    ? `moved: ${answer.threadId} starts on ${answer.transport} from its next turn`
    : `unchanged: ${answer.threadId} already runs on ${answer.transport}`;

export const movedDisplay = (answer: Moved): ToolDisplay => ({
  form: 'none',
  mutates: answer.status === 'switched',
  title: answer.threadId,
  facts: [{ label: answer.status === 'switched' ? 'moved onto' : 'already on', value: answer.transport }],
});
