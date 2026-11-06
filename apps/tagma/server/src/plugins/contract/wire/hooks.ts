import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';
import { PLUGIN_HOOK_POINTS } from './rows.js';

export const HOOK_REASON = 'hook';

export const TOOL_HOOK_TIMEOUT_MS = 10_000;

const LIST = /^[A-Za-z0-9_ ,|-]*$/u;

export const hookMatcher = (matcher: string | undefined, exactNames: boolean): ((subject: string) => boolean) | null => {
  if (matcher === undefined || matcher === '' || matcher === '*') return () => true;
  if (exactNames && LIST.test(matcher)) {
    const names = new Set(
      matcher
        .split(/[|,]/u)
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    );
    return (subject) => names.has(subject);
  }
  try {
    const pattern = new RegExp(matcher, 'u');
    return (subject) => pattern.test(subject);
  } catch {
    return null;
  }
};

const HandlerTool = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/u));

const HookEntry = Schema.Struct({
  at: Schema.Literals(PLUGIN_HOOK_POINTS).annotate({
    description:
      'When Tagma’s agent asks the hook. beforeTool: before a tool call runs; the hook may deny it, rewrite its input or add context. afterTool: after it ran; the hook may add context. beforeStep: when a message reaches the agent; the hook may block it or add context. beforeClose: before the agent ends its turn; a block keeps it working with the reason as its next instruction. threadStarted: on the first step of a new thread; the hook may add context. threadEnded: when the thread is archived or deleted.',
  }),
  match: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
    description:
      'Which calls reach the hook: names of Tagma’s own tools separated by |, or a regular expression over the name; startup or resume for threadStarted; archive or delete for threadEnded. Absent: every one. Claude Code’s and Codex’s own tools never reach it.',
  }),
  tool: HandlerTool.annotate({
    description:
      'The tool, named in contributes.tools with audience tagma, that Tagma calls with { at, threadId, cwd } and what the point carries, and that answers { deny?, input?, context?, block? }. The call wakes a sleeping process.',
  }),
  onFailure: Schema.optional(Schema.Literal('block')).annotate({
    description:
      'block: a hook that fails, answers an error or times out denies the tool call, or blocks the message, instead of letting it through. Absent: the agent goes on as if the hook had not been asked.',
  }),
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 600_000 }))).annotate({
    description:
      'How long Tagma waits for the answer, in milliseconds, a process start included; 10000 when absent. Past it the hook has failed.',
  }),
});
export type HookEntry = typeof HookEntry.Type;

export const HookEntries = Schema.Array(HookEntry);
export type HookEntries = typeof HookEntries.Type;

export const HookAnswer = Schema.Struct({
  deny: Schema.optional(Schema.String).annotate({ description: 'beforeTool: the call does not run, and the agent reads this reason.' }),
  input: Schema.optional(Schema.Unknown).annotate({ description: 'beforeTool: the call runs with this input instead of its own.' }),
  context: Schema.optional(Schema.String).annotate({
    description: 'Words the agent reads beside the call, the message or the new thread.',
  }),
  block: Schema.optional(Schema.String).annotate({
    description:
      'beforeStep: the message does not reach the agent, which reads this reason. beforeClose: the agent keeps working, reading this.',
  }),
});
export type HookAnswer = typeof HookAnswer.Type;

export const HOOKS_FACE: PluginFace<HookEntries> = {
  name: 'hooks',
  title: 'Checks Tagma’s agent before it acts — not Claude Code or Codex',
  schema: HookEntries,
  refuses: (entries) => {
    const unread = entries.find((entry) => hookMatcher(entry.match, true) === null);
    return unread === undefined ? null : `the match ${unread.match} is no list of tool names and no regular expression`;
  },
  calls: (entries) => entries.map((entry) => entry.tool),
};
