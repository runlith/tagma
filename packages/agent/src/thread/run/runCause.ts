import type { ActivityCause } from '@runlith/activity/cause';
import { userMessageEntryId } from '../../transcript/entryNames';
import { KEEP_WARM_SIGNAL_TYPE } from '../../transcript/keepWarm';

export function runCause(
  threadId: string,
  runId: string,
  delivered: readonly string[],
  transcript: readonly { readonly type: string; readonly id?: string; readonly runId?: string; readonly signalType?: string }[],
): ActivityCause | null {
  const actor = { kind: 'thread', id: threadId } as const;
  if (delivered.length > 0) return { actor, trigger: { kind: 'inbox', refs: delivered } };
  const opening = userMessageEntryId(runId);
  if (transcript.some((entry) => entry.id === opening)) return { actor, trigger: { kind: 'turn', refs: [opening] } };
  const warming = transcript.find(
    (entry) => entry.type === 'signal' && entry.runId === runId && entry.signalType === KEEP_WARM_SIGNAL_TYPE,
  );
  return warming?.id === undefined ? null : { actor, trigger: { kind: 'keep-warm', refs: [warming.id] } };
}
