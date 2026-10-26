import { Effect } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { stampText } from '@runlith/executions/protocol/artifact';
import type { UncertainEffect } from '@runlith/executions/protocol/host';
import type { Registration } from '@runlith/executions/protocol/registration';
import type { ExecutionPage, ExecutionSummary, OperationAnswer, RuntimeStatus } from '@runlith/executions/protocol/runtime';
import type { ShutdownAnswer, StopReceipt } from '@runlith/executions/protocol/stop';
import type { AuthorityAnswer } from '@runlith/executions/protocol/wire';
import { print } from '../../../platform/cli/verb.js';
import { type ResolvedHost, runRecovery, settleHostCall } from './resolve.js';

const executionShort = (ref: ExecutionRef): string => `${ref.execution}/${ref.incarnation}`;

const artifactText = (registration: Registration): string => {
  const artifact = registration.artifact;
  if (artifact === undefined) return 'artifact: none recorded';
  return `artifact: ${artifact.identity.digest} (${artifact.identity.build}) speaks ${artifact.protocol} wire ${stampText(artifact)}`;
};

const statusText = (host: ResolvedHost, status: RuntimeStatus): string => {
  const custody =
    status.custody.holder === undefined
      ? `vacant at revision ${status.custody.revision} epoch ${status.custody.epoch}`
      : `held by ${status.custody.holder.connection} at revision ${status.custody.revision} epoch ${status.custody.epoch}`;
  return [
    `host ${status.installation} at ${host.state} — incarnation ${status.incarnation}, admission ${status.phase}`,
    artifactText(host.registration),
    status.holder._tag === 'Standing' ? 'holder: standing' : `holder: lost (${status.holder.loss.reason}): ${status.holder.loss.detail}`,
    `custody ${custody}`,
    `executions: ${status.executions}`,
    ...(status.unadopted ?? []).map((kept) => `held but not taken up: ${kept.execution} (${kept.reason}) — ${kept.detail}`),
  ].join('\n');
};

export const showStatus = Effect.fnUntraced(function* (host: ResolvedHost, json: boolean) {
  const status = yield* runRecovery(host, (recovery) => recovery.status()).pipe(settleHostCall);
  if (json) return yield* print({ state: host.state, artifact: host.registration.artifact ?? null, status }, true);
  yield* print(statusText(host, status), false);
});

const summaryLine = (summary: ExecutionSummary): string => {
  const state = summary.state;
  const exit =
    state.nativeExit === undefined
      ? ''
      : state.nativeExit._tag === 'Code'
        ? ` exit ${state.nativeExit.code}`
        : ` signal ${state.nativeExit.signal}`;
  return `${executionShort(state.ref)} ${state.phase} ${state.transport}/${state.lifetime}/${state.purpose} cleanup ${state.cleanup} record ${state.record}${exit}`;
};

export const pageText = (page: ExecutionPage): string => {
  const lines = page.executions.map(summaryLine);
  if (page.after !== undefined) lines.push(`more remain — continue with --after ${page.after.execution}/${page.after.incarnation}`);
  return lines.length === 0 ? 'no executions held' : lines.join('\n');
};

const uncertainText = (effect: UncertainEffect): string => {
  const operation = effect.operation.operation;
  switch (effect._tag) {
    case 'InFlight':
      return `uncertain: ${operation} is in flight — read it back rather than retrying`;
    case 'StartUncertain':
      return `uncertain: the start under ${operation} may have landed on ${executionShort(effect.execution)} — read it back rather than retrying`;
    case 'StoreFailed':
      return `uncertain: ${operation} failed past the store at phase ${effect.phase} (cleanup ${effect.cleanup}): ${effect.reason}`;
    case 'NativeFailed':
      return `uncertain: ${operation} failed past the native boundary at phase ${effect.phase} (cleanup ${effect.cleanup}): ${effect.reason}`;
  }
};

export const operationText = (answer: OperationAnswer): string => {
  switch (answer._tag) {
    case 'Accepted':
      return answer.execution === undefined
        ? `accepted ${answer.operation.operation}`
        : `accepted ${answer.operation.operation} — execution ${executionShort(answer.execution)}`;
    case 'Cancelled':
      return `cancelled ${answer.operation.operation} — the key can never become a launch`;
    case 'Refused':
      return `refused ${answer.refusal._tag}: ${answer.refusal.reason}`;
    case 'Uncertain':
      return uncertainText(answer.effect);
    case 'Unanswered':
      return `unanswered ${answer.operation.operation} — nobody has taken this key`;
  }
};

export const receiptText = (receipt: StopReceipt): string => {
  const confirmed = receipt.confirmed.map(
    (ending) =>
      `pid ${ending.pid} (${ending.relation}) ${ending.exit._tag === 'Code' ? `exit ${ending.exit.code}` : `signal ${ending.exit.signal}`}`,
  );
  const residual = receipt.residual.map(
    (resource) =>
      `${resource.kind}${resource.pid === undefined ? '' : ` pid ${resource.pid}`}${resource.relation === undefined ? '' : ` (${resource.relation})`} — ${resource.detail}`,
  );
  const unverifiable = receipt.unverifiable.map((resource) => `${resource.kind} — ${resource.detail} (${resource.reason})`);
  return [
    `stop ${executionShort(receipt.execution)} under ${receipt.operation.operation}: ${receipt.relation} — asked ${receipt.requested} for ${receipt.cause}`,
    `confirmed ${confirmed.length}: ${confirmed.length === 0 ? 'none' : confirmed.join('; ')}`,
    `residual ${residual.length}: ${residual.length === 0 ? 'none' : residual.join('; ')}`,
    `unverifiable ${unverifiable.length}: ${unverifiable.length === 0 ? 'none' : unverifiable.join('; ')}`,
    `streams: ${receipt.streams.map((outcome) => `${outcome.stream}=${outcome.ending}`).join(' ') || 'none reported'}`,
    `cleanup ${receipt.cleanup}, retention ${receipt.retention}, abandoned output: ${receipt.abandonedOutput ? 'yes' : 'no'}`,
  ].join('\n');
};

export const shutdownText = (outcome: ShutdownAnswer): string => {
  switch (outcome._tag) {
    case 'ShutdownComplete':
      return [
        `shutdown complete under ${outcome.operation.operation}: ${outcome.executions.length} executions ended, nothing residual, nothing unmeasured`,
        ...outcome.executions.map(receiptText),
      ].join('\n');
    case 'ShutdownIncomplete':
      return [
        `shutdown INCOMPLETE under ${outcome.operation.operation}: ${outcome.reason} — admission stays fenced; re-run the identical command to resume it`,
        ...outcome.executions.map(receiptText),
        `residual ${outcome.residual.length}: ${outcome.residual.map((resource) => `${resource.kind} — ${resource.detail}`).join('; ') || 'none'}`,
        `unverifiable ${outcome.unverifiable.length}: ${outcome.unverifiable.map((resource) => `${resource.kind} — ${resource.detail} (${resource.reason})`).join('; ') || 'none'}`,
      ].join('\n');
    case 'Refused':
      return `refused ${outcome.refusal._tag}: ${outcome.refusal.reason}`;
    case 'Uncertain':
      return uncertainText(outcome.effect);
  }
};

export const authorityText = (outcome: AuthorityAnswer): string => {
  switch (outcome._tag) {
    case 'Held': {
      const holder = outcome.custody.holder === undefined ? 'vacant' : `held by ${outcome.custody.holder.connection}`;
      return `custody ${holder}: revision ${outcome.custody.revision} epoch ${outcome.custody.epoch}`;
    }
    case 'Bound':
      return `bound ${outcome.binding} for ${outcome.principal} at epoch ${outcome.epoch}`;
    case 'Unbound':
      return `unbound ${outcome.binding}`;
    case 'Stale':
      return `stale: decided over revision ${outcome.expected}, standing is revision ${outcome.standing.revision} — re-run with --expected-revision ${outcome.standing.revision}`;
    case 'Unresolved':
      return `unresolved: ${outcome.operation.operation} — re-run the identical command to settle it`;
    case 'Refused':
      return `refused ${outcome.refusal._tag}: ${outcome.refusal.reason}`;
    case 'Granted':
      return `granted a ${outcome.granted.share} share of ${outcome.granted.machineBytes} bytes: ${outcome.granted.grantBytes} bytes, ${outcome.reserved} reserved and ${outcome.retained} retained, ${outcome.over} above the grant`;
  }
};
