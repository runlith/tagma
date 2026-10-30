import { Cause, Exit, Option } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { notWarm } from '../contract/service/asks.js';
import type { RecapAttempt } from '../contract/wire/recap.js';
import type { RecapRefusal } from '../contract/wire/operations/recap.js';

export function recapRefusal(reason: string): GateRefusal<RecapRefusal> {
  switch (reason) {
    case 'gone':
      return new GateRefusal('not-found', 'This thread no longer exists.', ['open a thread from the project list']);
    case 'not-warm':
      return notWarm('This thread holds no warm copy of its conversation; a recap asks over the warm cache alone.', [
        'send a message in this thread, then use /recap while its prompt cache is warm',
      ]);
    case 'running':
      return new GateRefusal('recap-running', 'This thread or its recap is still running.', ['wait for it to finish, then use /recap']);
    case 'index-behind':
      return new GateRefusal('recap-index-behind', 'The conversation index does not cover the thread history completely.', [
        'wait for the conversation index to catch up, then use /recap',
      ]);
    case 'rewritten':
      return new GateRefusal('recap-rewritten', 'The captured conversation was compacted, rewound or edited.', [
        'send a message in this thread, then use /recap after the reply',
      ]);
    case 'selection':
      return new GateRefusal('recap-selection', 'The model, account or reasoning selection changed after the captured reply.', [
        'send a message with the current selection, then use /recap after the reply',
      ]);
    case 'moved':
    case 'superseded':
      return new GateRefusal('recap-moved', 'The conversation changed while the recap was being written; that result was not published.', [
        'use /recap after the new reply finishes',
      ]);
    case 'timeout':
      return new GateRefusal('recap-timeout', 'The model did not finish writing the recap before its response deadline.', [
        'try /recap again',
      ]);
    case 'tool-call':
      return new GateRefusal('recap-tool-call', 'The model called a tool instead of writing a recap; the tool was not executed.', [
        'try /recap again',
      ]);
    case 'too-long':
      return new GateRefusal('recap-too-long', 'The model returned a recap exceeding the accepted word limits.', ['try /recap again']);
    case 'empty-summary':
    case 'missing-frame':
      return new GateRefusal('recap-malformed', 'The model returned an incomplete recap.', ['try /recap again']);
    default:
      return new GateRefusal('recap-model-failed', 'The model request failed while writing the recap.', [
        'check the provider connection and try /recap again',
      ]);
  }
}

export function endingRefusal(exit: Exit.Exit<string | null, unknown>, manual: boolean): GateRefusal | null {
  if (Exit.isSuccess(exit)) {
    const reason = exit.value;
    if (reason === null || (!manual && (reason === 'superseded' || reason === 'disabled'))) return null;
    return recapRefusal(reason);
  }
  if (Cause.hasInterruptsOnly(exit.cause)) return null;
  const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
  return failure instanceof GateRefusal ? failure : recapRefusal('model-failed');
}

export function refusedAt(entryId: string, refusal: GateRefusal): RecapAttempt {
  return { state: 'refused', entryId, code: refusal.code, reason: refusal.reason, unblock: refusal.unblock };
}
