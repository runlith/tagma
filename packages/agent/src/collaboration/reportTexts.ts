import type { RunEnded } from '../thread/ending';
import type { ThreadRecord } from '../thread/record';

export const theAgent = (thread: ThreadRecord): string =>
  thread.name === null ? `The agent in thread ${thread.id}` : `The agent ${thread.name} (thread ${thread.id})`;

export function completionReport(source: ThreadRecord, ended: RunEnded, taken: string, collected: boolean): string {
  const prefix = `${theAgent(source)}, run ${ended.runId},`;
  if (ended.status === 'completed') {
    const answer = ended.answer;
    if (collected) return answer === null || answer.trim() === '' ? `${prefix} ended without a final answer or a last message.` : answer;
    const ran =
      taken === ended.runId
        ? `${prefix} ended the run your request opened`
        : `${prefix} was the last run of the work your request opened in run ${taken}, and it ended`;
    const ending = `${ran} without sending you its final answer, so your request stays open: it may still send that answer from a later run.`;
    return answer === null || answer.trim() === ''
      ? `${ending} The run left no last message either, so this ending says only that it stopped: nothing here says what was done, or whether what you asked for is finished.`
      : `${ending} What follows is that run's last message. The ending says the run stopped, never that your request is fulfilled: read the message for what was done and what was left, and judge from it. It says nothing about what the session is doing now either — words sent since may already have opened its next run.\n\n${answer}`;
  }
  if (ended.status === 'aborted' || ended.status === 'withdrawn') {
    return `${prefix} was stopped before finishing: ${ended.failureReason ?? 'the run was stopped'}.`;
  }
  if (ended.status === 'cut') {
    return `${prefix} was interrupted before finishing: ${ended.failureReason ?? 'the process driving it left and the run was not resumed'}. Its work stands where it stopped; ${
      source.capabilities.continue
        ? 'continue the thread to take it up again.'
        : 'send it words to start its next run: its transport cannot continue a run without them.'
    }`;
  }
  const failure = ended.failure;
  const retake = source.capabilities.continue
    ? { act: 'continue_agent', over: ' over its own history' }
    : { act: 'new words sent to it', over: ' with a new run: its transport cannot continue a run without words' };
  const facts = failure
    ? [
        `provider ${failure.provider ?? source.model?.provider ?? 'unknown'}`,
        `stage ${failure.stage}`,
        `type ${failure.type}`,
        ...(failure.httpStatus === undefined ? [] : [`HTTP ${failure.httpStatus}`]),
        failure.retryable === null ? 'retryability unknown' : failure.retryable ? 'retryable' : 'not retryable',
        failure.modelStarted === null
          ? 'model execution start unknown'
          : failure.modelStarted
            ? 'model execution started'
            : 'model execution never started',
      ].join(', ')
    : 'typed diagnostics unavailable';
  const address = failure?.record;
  const record = address
    ? ` Full failure record: thread ${address.threadId}, run ${address.runId}, entry ${address.entryId}.`
    : ` Full failure record: thread ${source.id}, run ${ended.runId}.`;
  return `${prefix} failed before finishing (${facts}): ${ended.failureReason ?? failure?.detail ?? 'run failed'}.${record} Its work stands where it stopped: a person on that thread, or ${retake.act}, may take it up${retake.over}. Where the diagnostics say the same call will fail again on this provider — quota or allowance exhausted, the provider unreachable, not retryable — set_agent_model moves it to another model before ${retake.act}; do not re-task it or start a replacement on your own initiative.`;
}

export function withdrawnRequestReport(target: ThreadRecord): string {
  return `${theAgent(target)} never took up your request: the operator removed it from that thread's queue before any run opened on it. This was a deliberate act by a person, not a failure: do not re-send it, re-task it or work around it on your own initiative. If the work still matters, say so to the operator.`;
}
