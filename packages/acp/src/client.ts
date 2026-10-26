import { Data, Result, Schema } from 'effect';
import type { Envelope } from '@runlith/ndjson-rpc/envelope';
import type { Inbound } from '@runlith/ndjson-rpc/exchange';
import { Draft } from './draft';
import type { Acted, Answer, ClientEvent, Delivery, Failure, Intent, Observation, Receipt, Step, TurnOutcome } from './events';
import {
  CancelRequestParams,
  InitializeResult,
  NewSessionResult,
  PROTOCOL,
  PromptResult,
  RequestPermissionParams,
  type SessionParams,
  SessionSetup,
  SetSessionConfigOptionResult,
} from './methods';
import type { AgentRequest, ClientRequest, ClientState, Reply } from './state';
import { SessionNotification } from './updates';

export class AnswerRefused extends Data.TaggedError('AnswerRefused')<{
  readonly id: string | number;
  readonly reason: 'unknown' | 'answered' | 'uncertain' | 'mismatched';
}> {}

type Settled = Extract<Envelope, { readonly _tag: 'Result' | 'Error' }>;
type Asking = Extract<Envelope, { readonly _tag: 'Request' }>;
type Notified = Extract<Envelope, { readonly _tag: 'Notification' }>;
type PromptRequest = Extract<ClientRequest, { readonly meaning: 'prompt' }>;

const INVALID_PARAMS = -32602;

const CANCELLED: Reply = { _tag: 'Result', result: { outcome: { outcome: 'cancelled' } } };

const decodeInitialize = Schema.decodeUnknownResult(InitializeResult);
const decodeNewSession = Schema.decodeUnknownResult(NewSessionResult);
const decodeSetup = Schema.decodeUnknownResult(SessionSetup);
const decodeConfigured = Schema.decodeUnknownResult(SetSessionConfigOptionResult);
const decodePrompt = Schema.decodeUnknownResult(PromptResult);
const decodePermission = Schema.decodeUnknownResult(RequestPermissionParams);
const decodeNotification = Schema.decodeUnknownResult(SessionNotification);
const decodeCancelRequest = Schema.decodeUnknownResult(CancelRequestParams);

const sent = (id: string) => ({ id, admitted: false, uncertain: false });

export const start = (incarnation: string): ClientState => ({
  incarnation,
  counter: 0,
  cursor: { offset: 0n, torn: false },
  requests: [],
  asks: [],
  turn: null,
  stopping: null,
  extensions: [],
});

const loading = (state: ClientState): boolean =>
  state.requests.some((request) => request.meaning === 'load' || request.meaning === 'resume');

const answered = (request: ClientRequest, result: unknown): ClientEvent => {
  const unreadable: ClientEvent = { _tag: 'RequestFailed', request, cause: { _tag: 'Unreadable', body: result } };
  switch (request.meaning) {
    case 'initialize': {
      const decoded = decodeInitialize(result);
      if (Result.isFailure(decoded)) return unreadable;
      if (decoded.success.protocolVersion !== PROTOCOL) {
        return { _tag: 'RequestFailed', request, cause: { _tag: 'Protocol', answered: decoded.success.protocolVersion } };
      }
      return { _tag: 'Initialized', result: decoded.success };
    }
    case 'new': {
      const decoded = decodeNewSession(result);
      if (Result.isFailure(decoded)) return unreadable;
      const { sessionId, ...setup } = decoded.success;
      return { _tag: 'SessionReady', via: 'new', sessionId, setup };
    }
    case 'load':
    case 'resume': {
      const decoded = decodeSetup(result ?? {});
      if (Result.isFailure(decoded)) return unreadable;
      return { _tag: 'SessionReady', via: request.meaning, sessionId: request.sessionId, setup: decoded.success };
    }
    case 'configure': {
      const decoded = decodeConfigured(result);
      if (Result.isFailure(decoded)) return unreadable;
      return { _tag: 'ConfigChanged', configOptions: decoded.success.configOptions };
    }
    case 'mode':
      return { _tag: 'ModeChanged', modeId: request.modeId };
    case 'close':
      return { _tag: 'SessionClosed', sessionId: request.sessionId };
    case 'extension':
      return { _tag: 'ExtensionAnswered', request, result };
    case 'prompt':
      return unreadable;
  }
};

const metaOf = (meta: unknown): Readonly<Record<string, unknown>> | null =>
  typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;

const withdrawn = (draft: Draft, leaving: (ask: AgentRequest) => boolean): void => {
  const asks = draft.state.asks.filter(leaving);
  if (asks.length === 0) return;
  draft.state = { ...draft.state, asks: draft.state.asks.filter((ask) => !leaving(ask)) };
  draft.emit({ _tag: 'Withdrawn', asks });
};

const turnEnded = (draft: Draft, prompt: PromptRequest, outcome: TurnOutcome, delivery: Delivery): void => {
  withdrawn(draft, (ask) => ask.turn === prompt.turn && ask.answer === null);
  draft.emit({ _tag: 'TurnEnded', turn: prompt.turn, envelopes: prompt.envelopes, delivery, outcome });
};

const promptSettled = (draft: Draft, prompt: PromptRequest, envelope: Settled): void => {
  const turn = draft.state.turn?.request === prompt.id ? draft.closed() : null;
  if (envelope._tag === 'Error') {
    const delivery = turn !== null ? 'accepted' : prompt.uncertain ? 'unconfirmed' : 'refused';
    turnEnded(draft, prompt, { _tag: 'Failed', cause: { _tag: 'Agent', error: envelope.error } }, delivery);
    return;
  }
  const decoded = decodePrompt(envelope.result);
  const outcome: TurnOutcome = Result.isFailure(decoded)
    ? { _tag: 'Failed', cause: { _tag: 'Unreadable', body: envelope.result } }
    : {
        _tag: 'Stopped',
        stopReason: decoded.success.stopReason,
        usage: decoded.success.usage ?? null,
        meta: metaOf(decoded.success._meta),
      };
  turnEnded(draft, prompt, outcome, 'accepted');
};

const settled = (draft: Draft, envelope: Settled): void => {
  const request = envelope.id === null ? undefined : draft.state.requests.find((standing) => standing.id === envelope.id);
  if (request === undefined) {
    draft.emit({ _tag: 'Stray', envelope });
    return;
  }
  draft.replaced(request, null);
  if (request.meaning === 'prompt') {
    promptSettled(draft, request, envelope);
    return;
  }
  draft.emit(
    envelope._tag === 'Error'
      ? { _tag: 'RequestFailed', request, cause: { _tag: 'Agent', error: envelope.error } }
      : answered(request, envelope.result),
  );
};

const asking = (draft: Draft, request: Asking): void => {
  if (draft.state.asks.some((ask) => ask.id === request.id)) {
    draft.emit({ _tag: 'Stray', envelope: request });
    return;
  }
  const turn = draft.turn();
  const other: AgentRequest = {
    kind: 'other',
    id: request.id,
    turn: turn?.id ?? null,
    method: request.method,
    params: request.params,
    answer: null,
    uncertain: false,
  };
  if (request.method !== 'session/request_permission') {
    draft.flush();
    draft.held(other);
    draft.emit({ _tag: 'Asked', ask: other });
    return;
  }
  const decoded = decodePermission(request.params);
  if (Result.isFailure(decoded)) {
    draft.held(other);
    draft.answer(other, {
      _tag: 'Error',
      error: { code: INVALID_PARAMS, message: 'session/request_permission params do not match ACP v1', data: request.params },
    });
    return;
  }
  if (turn !== null) draft.called(turn, decoded.success.toolCall, true);
  draft.flush();
  const ask: AgentRequest = {
    kind: 'permission',
    id: request.id,
    turn: turn?.id ?? null,
    params: decoded.success,
    answer: null,
    uncertain: false,
  };
  draft.held(ask);
  if (turn !== null && draft.prompt()?.cancelled === true) draft.answer(ask, CANCELLED);
  else draft.emit({ _tag: 'Asked', ask });
};

const updated = (draft: Draft, params: unknown): void => {
  if (loading(draft.state)) return;
  const turn = draft.turn();
  const decoded = decodeNotification(params);
  if (Result.isFailure(decoded)) {
    draft.emit({ _tag: 'Unrecognized', method: 'session/update', raw: params });
    return;
  }
  const update = decoded.success.update;
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
      if (turn === null) break;
      draft.chunk(turn, update.sessionUpdate === 'agent_message_chunk' ? 'message' : 'thought', update.messageId ?? null, update.content);
      return;
    case 'tool_call':
    case 'tool_call_update': {
      if (turn === null) break;
      const { sessionUpdate, ...call } = update;
      draft.called(turn, call, sessionUpdate === 'tool_call');
      return;
    }
    case 'current_mode_update':
      draft.emit({ _tag: 'ModeChanged', modeId: update.currentModeId });
      return;
    case 'config_option_update':
      draft.emit({ _tag: 'ConfigChanged', configOptions: update.configOptions });
      return;
  }
  draft.emit({ _tag: 'SessionChanged', update });
};

const notified = (draft: Draft, notification: Notified): void => {
  if (notification.method === 'session/update') {
    updated(draft, notification.params);
    return;
  }
  if (notification.method === '$/cancel_request') {
    const decoded = decodeCancelRequest(notification.params);
    if (Result.isSuccess(decoded)) {
      withdrawn(draft, (ask) => ask.id === decoded.success.requestId && ask.answer === null);
      return;
    }
  }
  if (notification.method.startsWith('$/')) {
    draft.emit({ _tag: 'Signaled', turn: draft.turn()?.id ?? null, method: notification.method, params: notification.params });
    return;
  }
  if (draft.state.extensions.includes(notification.method)) {
    draft.flush();
    draft.emit({
      _tag: 'Extended',
      id: `${draft.state.incarnation}:${draft.state.cursor.offset}`,
      method: notification.method,
      params: notification.params,
    });
    return;
  }
  draft.emit({ _tag: 'Unrecognized', method: notification.method, raw: notification.params });
};

const framed = (state: ClientState, inbound: Inbound): Step => {
  if (inbound.end <= state.cursor.offset) return { state, frames: [], events: [], durable: false };
  const draft = new Draft({ ...state, cursor: { offset: inbound.end, torn: false } });
  const message = inbound.message;
  switch (message._tag) {
    case 'Malformed':
      draft.emit({ _tag: 'Malformed', problem: message.problem, excerpt: message.excerpt });
      break;
    case 'Result':
    case 'Error':
      settled(draft, message);
      break;
    case 'Request':
      asking(draft, message);
      break;
    case 'Notification':
      notified(draft, message);
      break;
  }
  return draft.done(false);
};

const uncertain = (draft: Draft, request: (request: ClientRequest) => boolean, ask: (ask: AgentRequest) => boolean): void => {
  const requests = draft.state.requests
    .filter((standing) => !standing.uncertain && request(standing))
    .map((standing) => ({ ...standing, uncertain: true }));
  const asks = draft.state.asks
    .filter((standing) => !standing.uncertain && ask(standing))
    .map((standing) => ({ ...standing, uncertain: true }));
  if (requests.length === 0 && asks.length === 0) return;
  draft.state = {
    ...draft.state,
    requests: draft.state.requests.map((standing) => requests.find((marked) => marked.id === standing.id) ?? standing),
    asks: draft.state.asks
      .filter((standing) => standing.answer === null)
      .map((standing) => asks.find((marked) => marked.id === standing.id) ?? standing),
  };
  draft.emit({ _tag: 'Uncertain', requests, asks });
};

const unwritten = (draft: Draft, receipt: Receipt): boolean => {
  if (receipt._tag === 'Answer') {
    const ask = draft.state.asks.find((standing) => standing.id === receipt.id && standing.answer !== null);
    if (ask === undefined) return false;
    const reopened: AgentRequest = { ...ask, answer: null };
    draft.asked(ask, reopened);
    const prompt = draft.prompt();
    if (ask.kind === 'permission' && prompt?.cancelled && ask.turn === prompt.turn) draft.answer(reopened, CANCELLED);
    else draft.emit({ _tag: 'Asked', ask: reopened });
    return true;
  }
  const request = draft.state.requests.find((standing) => standing.id === receipt.id);
  if (request === undefined) return false;
  draft.replaced(request, null);
  const cause: Failure = { _tag: 'Unwritten' };
  if (request.meaning === 'prompt')
    turnEnded(
      draft,
      request,
      request.cancelled ? { _tag: 'Stopped', stopReason: 'cancelled', usage: null, meta: null } : { _tag: 'Failed', cause },
      'refused',
    );
  else draft.emit({ _tag: 'RequestFailed', request, cause });
  return true;
};

const unknown = (draft: Draft, receipt: Receipt): boolean => {
  if (receipt._tag === 'Answer') {
    const ask = draft.state.asks.find((standing) => standing.id === receipt.id && standing.answer !== null);
    if (ask === undefined) return false;
    draft.asked(ask, null);
    draft.emit({ _tag: 'Uncertain', requests: [], asks: [{ ...ask, uncertain: true }] });
    return true;
  }
  const request = draft.state.requests.find((standing) => standing.id === receipt.id && !standing.uncertain);
  if (request === undefined) return false;
  const marked = { ...request, uncertain: true };
  draft.replaced(request, marked);
  draft.emit({ _tag: 'Uncertain', requests: [marked], asks: [] });
  return true;
};

const unsettled = (draft: Draft): void => {
  const asks = draft.state.asks.filter((standing) => standing.answer !== null);
  const requests = draft.state.requests
    .filter((standing) => !standing.uncertain && !standing.admitted)
    .map((standing) => ({ ...standing, uncertain: true }));
  if (asks.length === 0 && requests.length === 0) return;
  draft.state = {
    ...draft.state,
    requests: draft.state.requests.map((standing) => requests.find((marked) => marked.id === standing.id) ?? standing),
    asks: draft.state.asks.filter((standing) => standing.answer === null),
  };
  draft.emit({ _tag: 'Uncertain', requests, asks: asks.map((ask) => ({ ...ask, uncertain: true })) });
};

const oversized = (draft: Draft, start: bigint, ceiling: number, session: SessionParams | null): void => {
  draft.state = { ...draft.state, cursor: { offset: start + 1n, torn: true } };
  const current = draft.prompt();
  if (current === undefined) {
    draft.emit({ _tag: 'Malformed', problem: `a line over ${ceiling} bytes was skipped`, excerpt: '' });
    return;
  }
  draft.closed();
  draft.replaced(current, null);
  if (session !== null) draft.write({ _tag: 'Notification', method: 'session/cancel', params: session }, null);
  turnEnded(draft, current, { _tag: 'Failed', cause: { _tag: 'Oversized', ceiling } }, 'accepted');
};

const admitted = (draft: Draft, receipt: Receipt): boolean => {
  if (receipt._tag === 'Answer') {
    const ask = draft.state.asks.find((standing) => standing.id === receipt.id && standing.answer !== null);
    if (ask === undefined) return false;
    draft.asked(ask, null);
    return true;
  }
  const request = draft.state.requests.find((standing) => standing.id === receipt.id);
  if (request === undefined || request.admitted) return false;
  draft.replaced(request, { ...request, admitted: true });
  return true;
};

const exited = (draft: Draft, detail: string): void => {
  const current = draft.prompt();
  const worked = draft.state.turn?.request ?? null;
  draft.closed();
  const cause: Failure = { _tag: 'Exited', detail };
  for (const request of draft.state.requests) {
    if (request.meaning !== 'prompt') {
      draft.emit({ _tag: 'RequestFailed', request, cause });
      continue;
    }
    const outcome: TurnOutcome =
      request === current && request.cancelled
        ? { _tag: 'Stopped', stopReason: 'cancelled', usage: null, meta: null }
        : { _tag: 'Failed', cause };
    const delivery: Delivery = request.id === worked ? 'accepted' : request.admitted || request.uncertain ? 'unconfirmed' : 'refused';
    draft.emit({ _tag: 'TurnEnded', turn: request.turn, envelopes: request.envelopes, delivery, outcome });
  }
  if (draft.state.asks.length > 0) draft.emit({ _tag: 'Withdrawn', asks: draft.state.asks });
  draft.state = { ...draft.state, requests: [], asks: [], turn: null, stopping: null };
};

export const receive = (state: ClientState, observation: Observation): Step => {
  if (observation._tag === 'Frame') return framed(state, observation.inbound);
  const draft = new Draft(state);
  switch (observation._tag) {
    case 'Gap':
      draft.flush();
      draft.emit({ _tag: 'Gapped', from: state.cursor.offset, to: observation.resume });
      uncertain(
        draft,
        () => true,
        () => true,
      );
      draft.state = { ...draft.state, cursor: { offset: observation.resume, torn: true } };
      return draft.done(true);
    case 'Admitted':
      return draft.done(admitted(draft, observation.receipt));
    case 'Unwritten':
      return draft.done(unwritten(draft, observation.receipt));
    case 'Unknown':
      return draft.done(unknown(draft, observation.receipt));
    case 'Oversized':
      oversized(draft, observation.start, observation.ceiling, observation.session);
      return draft.done(true);
    case 'Recovered':
      unsettled(draft);
      return draft.done(true);
    case 'Exited':
      exited(draft, observation.detail);
      return draft.done(true);
  }
};

const cancel = (draft: Draft, params: SessionParams): void => {
  const current = draft.prompt();
  draft.write({ _tag: 'Notification', method: 'session/cancel', params }, null);
  if (current === undefined) return;
  draft.replaced(current, { ...current, cancelled: true });
  const withdrawn = draft.state.asks.filter(
    (ask) => ask.kind === 'permission' && ask.answer === null && !ask.uncertain && ask.turn === current.turn,
  );
  for (const ask of withdrawn) draft.answer(ask, CANCELLED);
  if (withdrawn.length > 0) draft.emit({ _tag: 'Withdrawn', asks: withdrawn });
};

export const checkpoint = (state: ClientState): Step => {
  const draft = new Draft(state);
  draft.flush();
  return draft.done(true);
};

export const kept = (state: ClientState): Step => new Draft(state).done(true);

export const act = (state: ClientState, intent: Intent): Acted => {
  const draft = new Draft(state);
  switch (intent._tag) {
    case 'Extensions':
      return { state: { ...state, extensions: [...intent.methods] }, frames: [], events: [], durable: true, request: null };
    case 'Initialize':
      draft.request(
        'initialize',
        { protocolVersion: PROTOCOL, clientCapabilities: intent.capabilities, clientInfo: intent.info },
        (id) => ({ ...sent(id), meaning: 'initialize' }),
      );
      break;
    case 'NewSession':
      draft.request('session/new', intent.params, (id) => ({ ...sent(id), meaning: 'new' }));
      break;
    case 'LoadSession':
      draft.request('session/load', intent.params, (id) => ({ ...sent(id), meaning: 'load', sessionId: intent.params.sessionId }));
      break;
    case 'ResumeSession':
      draft.request('session/resume', intent.params, (id) => ({ ...sent(id), meaning: 'resume', sessionId: intent.params.sessionId }));
      break;
    case 'Prompt':
      draft.request('session/prompt', intent.params, (id) => ({
        ...sent(id),
        meaning: 'prompt',
        turn: intent.turn,
        envelopes: intent.envelopes,
        cancelled: false,
      }));
      break;
    case 'Configure':
      draft.request('session/set_config_option', intent.params, (id) => ({
        ...sent(id),
        meaning: 'configure',
        configId: intent.params.configId,
      }));
      break;
    case 'SetMode':
      draft.request('session/set_mode', intent.params, (id) => ({ ...sent(id), meaning: 'mode', modeId: intent.params.modeId }));
      break;
    case 'Close':
      draft.request('session/close', intent.params, (id) => ({ ...sent(id), meaning: 'close', sessionId: intent.params.sessionId }));
      break;
    case 'Extend':
      draft.request(intent.method, intent.params, (id) => ({
        ...sent(id),
        meaning: 'extension',
        method: intent.method,
        envelopes: intent.envelopes,
      }));
      break;
    case 'Cancel':
      cancel(draft, intent.params);
      break;
    case 'Stop':
      cancel(draft, intent.params);
      draft.state = { ...draft.state, stopping: intent.until };
      break;
  }
  return { ...draft.done(true), request: draft.issued };
};

export const answer = (state: ClientState, id: string | number, reply: Answer): Result.Result<Step, AnswerRefused> => {
  const ask = state.asks.find((standing) => standing.id === id);
  if (ask === undefined) return Result.fail(new AnswerRefused({ id, reason: 'unknown' }));
  if (ask.answer !== null) return Result.fail(new AnswerRefused({ id, reason: 'answered' }));
  if (ask.uncertain) return Result.fail(new AnswerRefused({ id, reason: 'uncertain' }));
  if (reply._tag === 'Permission' && ask.kind !== 'permission') return Result.fail(new AnswerRefused({ id, reason: 'mismatched' }));
  const recorded: Reply = reply._tag === 'Permission' ? { _tag: 'Result', result: { outcome: reply.outcome } } : reply;
  const draft = new Draft(state);
  draft.answer(ask, recorded);
  return Result.succeed(draft.done(true));
};
