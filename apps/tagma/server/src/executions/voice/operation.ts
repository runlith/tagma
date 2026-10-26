import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { UncertainEffect } from '@runlith/executions/protocol/host';
import type { InputAnswer } from '@runlith/executions/protocol/input';
import { UNVOICED } from '../../platform/contract/service/presentation.js';
import type { TerminalOperationReading } from '../contract/wire/operationAnswers.js';
import type { TerminalOperationState } from '../contract/wire/requestKeys.js';
import { alsoWords, type Answered, refWords } from './execution.js';
import { stopText } from './commands.js';

const onto = (execution: ExecutionRef | undefined, copies: readonly (ExecutionRef | undefined)[] = []): string => {
  if (execution === undefined) return '';
  const also = alsoWords(execution, copies);
  return ` — execution ${refWords(execution)}${also === '' ? '' : `, ${also}`}`;
};

const receiptOf = (input: InputAnswer | undefined): ExecutionRef | undefined =>
  input?._tag === 'InputAdmitted' ? input.receipt.execution : undefined;

const UNCERTAIN_WORDS: Readonly<Record<UncertainEffect['_tag'], string>> = {
  InFlight: 'the host has not answered it yet',
  StartUncertain: 'nobody can say whether its process started',
  StoreFailed: 'the host acted and the record of it could not be written',
  NativeFailed: 'the operating system failed under it',
};

const inputWords = (input: InputAnswer): string => {
  switch (input._tag) {
    case 'InputAdmitted':
      return `${input.receipt.bytes} bytes ${input.receipt.cause} admitted as sequence ${input.receipt.sequence}, accepted through ${input.receipt.acceptedThrough}`;
    case 'InputEnded':
      return 'input ended';
    case 'InputBackpressure':
      return `held back: ${input.pendingBytes} bytes pending of ${input.limit}, accepted through ${input.frontier.acceptedThrough}`;
    case 'InputConflict':
      return `sequence ${input.sequence} names another act`;
    case 'InputReceiptExpired':
      return `receipt of sequence ${input.sequence} expired; receipts are kept from ${input.retainedFrom}`;
    case 'InputUnsupported':
      return `${input.act} unsupported: ${input.reason} — ${input.detail}`;
  }
};

const stateLine = (state: TerminalOperationState): string => {
  switch (state._tag) {
    case 'Unknown':
      return `operation ${state.operation.operation} unknown: no act is recorded under it`;
    case 'Expired':
      return `operation ${state.operation.operation} (${state.mutation}) expired: its detail is retired and the key stays taken`;
    case 'Pending':
      return `operation ${state.key.operationId} (${state.key.mutation}) pending${onto(state.key.execution)}: read it back by its id`;
    case 'Admitted':
      return `operation ${state.key.operationId} (${state.key.mutation}) admitted${onto(state.execution, [state.key.execution])}`;
    case 'Settled': {
      const receipt = receiptOf(state.input);
      return `operation ${state.key.operationId} (${state.key.mutation}) settled${onto(state.execution ?? state.key.execution ?? receipt, [
        state.key.execution,
        receipt,
      ])}${state.input === undefined ? '' : `; ${inputWords(state.input)}`}`;
    }
    case 'Uncertain': {
      const { effect } = state;
      const execution = effect._tag === 'InFlight' ? state.key.execution : (effect.execution ?? state.key.execution);
      const host = effect.operation.operation === state.key.operationId ? '' : `, host operation ${effect.operation.operation}`;
      return `operation ${state.key.operationId} (${state.key.mutation}) uncertain${onto(execution, [state.key.execution])}${host}: ${UNCERTAIN_WORDS[effect._tag]}${
        effect._tag === 'StoreFailed' || effect._tag === 'NativeFailed' ? ` (${effect.reason})` : ''
      }; read it back by its id`;
    }
  }
};

function* operationLines(reading: typeof TerminalOperationReading.Type): Generator<string> {
  const { operation } = reading;
  if (operation._tag === 'Whole') {
    yield stateLine(operation.state);
    if (operation.state._tag === 'Settled' && operation.state.stop !== undefined) {
      yield stopText({ status: 'ok', receipt: operation.state.stop });
    }
    return;
  }
  const { digest } = operation;
  yield `operation ${digest.operation.operation}${digest.mutation === undefined ? '' : ` (${digest.mutation})`} ${digest.phase}${onto(digest.execution)}`;
}

export const operationVoice = (answer: Answered<typeof TerminalOperationReading.Type>) =>
  answer.status === 'ok' ? operationLines(answer) : UNVOICED;
