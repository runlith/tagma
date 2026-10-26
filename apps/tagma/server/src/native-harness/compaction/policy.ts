import { Effect } from 'effect';
import { DEFAULT_COMPACTION_TRIGGER } from '@runlith/llm/models/description';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { ThreadCompactionPolicy, ThreadCompactionTriggerOverride } from '@runlith/agent/thread/compaction/policy';
import type { ThreadCompactionPrompt } from '@runlith/agent/thread/compaction/summaryStrategy';
import type { ThreadCompactionText } from '@runlith/agent/thread/compaction/text';
import type { ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import type { Settings } from '../../settings/contract/service/values.js';
import { compactionOverrides, compactionStrategy, compactionTrigger } from '../contract/wire/compactionSettings.js';
import { toolOutputShare } from '../contract/wire/settings.js';
import { stored } from '../../platform/store/crossing.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';

const COMPACTION_BUFFER_TOKENS = 20_000;
const COMPACTION_OPENING_TOKENS = 8_000;

export const COMPACTION_POLICY = (
  toolPruneProtectShare: number,
  trigger: ThreadCompactionPolicy['compactionTrigger'] = DEFAULT_COMPACTION_TRIGGER,
  overrides: readonly ThreadCompactionTriggerOverride[] = [],
): ThreadCompactionPolicy => ({
  bufferTokens: COMPACTION_BUFFER_TOKENS,
  imageTokens: 1_600,
  maxRecentTokens: COMPACTION_BUFFER_TOKENS * 0.4,
  minRecentTokens: COMPACTION_BUFFER_TOKENS * 0.1,
  maxOpeningTokens: COMPACTION_OPENING_TOKENS,
  recentFraction: 0.25,
  recentUserTurns: 2,
  toolPruneProtectShare,
  compactionTrigger: trigger,
  compactionOverrides: overrides,
});

export const COMPACTION_TEXT: ThreadCompactionText = {
  checkpointMarker: 'Continue from the anchored thread state below.',
  prunedToolOutput: '[Old tool result content cleared]',
  overflowMediaGuidance:
    'The previous provider request exceeded its size limit, so media attached before the latest turn was omitted from this retry; media of the latest turn is still attached. MUST continue from what is available. If the answer depends on omitted earlier media, ask the user to attach it again.',
  omittedMedia: (mediaType) => `[Attached ${mediaType ?? 'media'} omitted to keep requests within the provider's limits.]`,
};

export const COMPACTION_PROMPT: ThreadCompactionPrompt = {
  instructions: `You maintain the anchored state of a long-running assistant thread.
MUST preserve the user's objective, constraints, decisions, important facts, completed work, active work, blockers, and exact identifiers needed to continue.
MUST update the prior summary when provided, keeping still-valid facts and removing stale ones.
MUST output concise Markdown only. DON'T mention compaction or the summarization process.`,
  template: `Use exactly these sections:
## Objective
## Important Details
## Completed
## Active
## Blocked
## Next Move
## Relevant References`,
};

export const projectPolicy = Effect.fnUntraced(function* (
  settings: Settings['Service'],
  projectId: number,
): Effect.fn.Return<ThreadCompactionPolicy, ThreadPortFailure> {
  const share = yield* settings.held(toolOutputShare, projectId).pipe(stored('toolOutputShare'));
  const strategy = yield* settings.held(compactionStrategy, projectId).pipe(stored('compactionStrategy'));
  const trigger = yield* settings.held(compactionTrigger, projectId).pipe(stored('compactionTrigger'));
  const overrides = yield* settings.held(compactionOverrides, projectId).pipe(stored('compactionOverrides'));
  return COMPACTION_POLICY(
    share(),
    strategy() === 'reserve-output' ? { strategy: 'reserve-output' } : { strategy: 'percent', trigger: trigger() },
    overrides(),
  );
});

export const compactionPolicy = Effect.fnUntraced(function* (
  records: ThreadRecords['Service'],
  settings: Settings['Service'],
  threadId: string,
): Effect.fn.Return<ThreadCompactionPolicy, ThreadPortFailure> {
  const projectId = yield* records.projectOf(threadId).pipe(stored('projectOf'));
  if (projectId === undefined) return yield* Effect.fail(new ThreadNotFoundError(threadId));
  return yield* projectPolicy(settings, projectId);
});

export const COMPACTION_KEYS: ReadonlySet<string> = new Set([compactionStrategy.id, compactionTrigger.id, compactionOverrides.id]);
