import type { Refusal } from '@runlith/executions/protocol/host';
import { custodySentence } from './ExecutionCustody';
import { InputProfileConflict } from './InputModes';
import { InterpretationUnavailable } from './Interpretation';
import { CursorRefused, StreamMissing } from './ExecutionRecord';
import { InputFenced } from './ExecutionInput';
import { LaneUnserved } from './TerminalInputs';

const capacityReason = (failure: { readonly _tag: string }): string => {
  if (failure._tag === 'CapacityRefused' && 'budget' in failure && 'requested' in failure && 'limit' in failure) {
    return `budget ${String(failure.budget)} exceeded: requested ${String(failure.requested)} of ${String(failure.limit)}`;
  }
  if (failure._tag === 'ReservationMissing' && 'execution' in failure) {
    return `no reservation stands for execution ${String(failure.execution)}`;
  }
  if (failure._tag === 'ReceiptCountInvalid' && 'supplied' in failure && 'reason' in failure) {
    return `receipts ${String(failure.supplied)} refused: ${String(failure.reason)}`;
  }
  return failure._tag;
};

const memoryReason = (failure: { readonly _tag: string }): string =>
  'reserve' in failure && 'reserved' in failure && 'retained' in failure && 'grant' in failure
    ? `a reserve of ${String(failure.reserve)} bytes does not fit: ${String(failure.reserved)} reserved and ${String(failure.retained)} retained under a grant of ${String(failure.grant)}`
    : failure._tag;

const recordReadReason = (failure: { readonly _tag: string }): string => {
  const stream = 'stream' in failure ? String(failure.stream) : 'a stream';
  const detail = 'detail' in failure ? String(failure.detail) : 'unstated';
  const act = 'act' in failure ? failure.act : undefined;
  const said = act === 'missing' ? 'is missing' : act === 'open' ? 'could not be opened' : 'could not be read';
  return `the ${stream} record ${said}: ${detail}`;
};

export const refusalOf = (failure: { readonly _tag: string }): Refusal => {
  if (failure instanceof InputProfileConflict)
    return {
      _tag: 'InputProfileConflict',
      expected: failure.expected,
      actual: failure.actual,
      reason: `input encoded against profile revision ${failure.actual} while ${failure.expected} stands`,
    };
  if (failure instanceof InterpretationUnavailable) return { _tag: 'InterpretationUnavailable', reason: failure.detail };
  if (failure instanceof CursorRefused) return { _tag: 'HostConflict', reason: `${failure._tag}: ${failure.message}` };
  if (failure instanceof StreamMissing) return { _tag: 'StreamMissing', reason: failure.message };
  if (failure instanceof InputFenced)
    return { _tag: failure.reason === 'yielding' ? 'InputYielding' : 'InputFenced', reason: failure.message };
  if (failure instanceof LaneUnserved) return { _tag: 'UnsupportedCapability', reason: failure.detail };
  switch (failure._tag) {
    case 'OperationConflict':
      return { _tag: 'OperationConflict', reason: 'the operation key is already taken or was fenced before admission' };
    case 'ExecutionUnknown':
    case 'StoredExecutionMissing':
      return { _tag: 'UnknownExecution', reason: 'this host holds no execution under that reference' };
    case 'CapacityRefused':
    case 'ReservationMissing':
    case 'ReceiptCountInvalid':
      return { _tag: 'CapacityExceeded', reason: capacityReason(failure) };
    case 'MemoryUnavailable':
      return { _tag: 'MemoryExhausted', reason: memoryReason(failure) };
    case 'InterpretationMissing':
      return { _tag: 'UnsupportedCapability', reason: 'this execution has no interpreted screen' };
    case 'CustodianRefused':
    case 'RoleRefused':
      return { _tag: 'Unauthorized', reason: failure._tag };
    case 'CustodyLost':
      return 'reason' in failure && failure.reason === 'unresolved'
        ? { _tag: 'Unauthorized', reason: failure._tag }
        : { _tag: 'HostConflict', reason: failure._tag };
    case 'NotHolder':
      return {
        _tag: 'CustodyConflict',
        reason: custodySentence(failure as Parameters<typeof custodySentence>[0]),
      };
    case 'AdmissionRefused':
      return { _tag: 'AdmissionClosed', reason: 'this host admits no more work' };
    case 'ExecutionUnreadable':
      return {
        _tag: 'HostUnavailable',
        reason: `this host could not read what it holds: ${'reason' in failure ? String(failure.reason) : 'unstated'}`,
      };
    case 'StopUnadmitted':
      return {
        _tag: 'HostUnavailable',
        reason: `the stop was not admitted: ${'reason' in failure ? String(failure.reason) : 'unstated'}`,
      };
    case 'ExecutionUnrecorded':
      return {
        _tag: 'HostUnavailable',
        reason: `this host could not record what it did: ${'reason' in failure ? String(failure.reason) : 'unstated'}`,
      };
    case 'RecordReadFailed':
      return { _tag: 'HostUnavailable', reason: recordReadReason(failure) };
    default:
      return { _tag: 'HostConflict', reason: failure._tag };
  }
};
