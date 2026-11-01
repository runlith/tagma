import type { RefusalBody } from '@tagma/server/platform/contract/wire/refusal';
import { Cause, Result, SchemaIssue } from 'effect';
import { RpcClientError } from 'effect/rpc';
import type { ConnectionFailure, LiveFailure } from './Live.js';

export type LiveError = RefusalBody | RpcClientError.RpcClientError;

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

export function failureFromCause(cause: Cause.Cause<LiveError>): LiveFailure {
  const found = Cause.findError(cause);
  return Result.isSuccess(found) ? failureOf(found.success) : { kind: 'subscription', message: causeText(cause) };
}

export function failureOf(error: unknown): LiveFailure {
  if (isRefusal(error)) {
    return {
      kind: 'subscription',
      message: error.reason,
      code: error.code,
      unblock: [...error.unblock],
      words: error.words,
      right: error.right,
    };
  }
  if (!(error instanceof RpcClientError.RpcClientError)) {
    return { kind: 'subscription', message: messageOf(error) };
  }
  const reason = error.reason;
  switch (reason._tag) {
    case 'SocketCloseError':
      return {
        kind: 'connection',
        message: closeMessage(reason.code, reason.closeReason),
        code: reason.code,
        reason: reason.closeReason,
      };
    case 'SocketOpenError': {
      const cause = messageOf(reason.cause);
      return {
        kind: 'connection',
        message:
          cause === 'ping timeout'
            ? 'The live connection to the Tagma server stopped answering heartbeats.'
            : `The live connection to the Tagma server did not open: ${cause}`,
      };
    }
    case 'SocketReadError':
      return { kind: 'connection', message: 'The live connection to the Tagma server could not be read.' };
    case 'SocketWriteError':
      return { kind: 'connection', message: 'The live connection to the Tagma server could not be written.' };
    case 'RpcClientDefect':
      return { kind: 'connection', message: `The live connection to the Tagma server broke: ${reason.message}` };
    default:
      return { kind: 'subscription', message: error.message };
  }
}

export function closeFailure(event: globalThis.CloseEvent): ConnectionFailure {
  return {
    kind: 'connection',
    message: closeMessage(event.code, event.reason),
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
  };
}

function closeMessage(code: number, reason?: string): string {
  return `The live connection to the Tagma server closed (${code}${reason ? `: ${reason}` : ''}).`;
}

export function causeText<E>(cause: Cause.Cause<E>): string {
  return messageOf(Cause.squash(cause));
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return SchemaIssue.isIssue(error.cause) ? `${error.message}\n${formatSchemaIssue(error.cause)}` : error.message;
  }
  if (error instanceof globalThis.Event) return 'the socket closed without saying why';
  return String(error);
}

function isRefusal(error: unknown): error is RefusalBody {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as Partial<RefusalBody>;
  return typeof value.code === 'string' && typeof value.reason === 'string' && Array.isArray(value.unblock);
}
