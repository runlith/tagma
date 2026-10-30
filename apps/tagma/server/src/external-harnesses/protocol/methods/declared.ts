import type { ClientEvent } from '@runlith/acp/events';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import {
  ASIDE,
  BACKGROUND,
  COMPACT,
  COMPACTED,
  COMPACTING,
  FORK,
  REWIND,
  QUOTA,
  RETRYING,
  SAID,
  STEER,
  WITHDRAW,
  type Extension,
  type Notification,
} from '@runlith/hosted-runner/wire/extensions';
import type { ProtocolRow } from '../row.js';
import { aside } from './aside.js';
import { background } from './background.js';
import { compact } from './compact.js';
import { handled, type Answering, type Handled, type Noticing, type Settlement } from './declaration.js';
import { fork, rewind } from './fork.js';
import { retrying } from './retrying.js';
import { said } from './said.js';
import { steer } from './steer.js';
import { withdraw } from './withdraw.js';

const answering: { readonly [M in Extension]: Answering } = {
  [STEER]: steer,
  [WITHDRAW]: withdraw,
  [COMPACT]: compact,
  [FORK]: fork,
  [REWIND]: rewind,
  [ASIDE]: aside,
};

const noticing: { readonly [N in Notification]: Noticing } = {
  [COMPACTED]: compact,
  [COMPACTING]: compact,
  [SAID]: said,
  [BACKGROUND]: background,
  [QUOTA]: { noticed: (row, event) => handled(row, [event]) },
  [RETRYING]: retrying,
};

const declared = <K extends string, D>(table: { readonly [M in K]: D }, method: string): D | undefined =>
  Object.hasOwn(table, method) ? table[method as K] : undefined;

export type Read = { readonly _tag: 'Handled'; readonly handled: Handled } | { readonly _tag: 'Undeclared'; readonly method: string };

export const read = (row: ProtocolRow, event: ClientEvent, at: string): Read | null => {
  if (event._tag === 'Extended') {
    const method = declared(noticing, event.method);
    return method === undefined
      ? { _tag: 'Undeclared', method: event.method }
      : { _tag: 'Handled', handled: method.noticed(row, event, at) };
  }
  if (event._tag !== 'ExtensionAnswered' && event._tag !== 'RequestFailed') return null;
  const request = event.request;
  if (request.meaning !== 'extension') return null;
  const method = declared(answering, request.method);
  return method === undefined
    ? { _tag: 'Undeclared', method: request.method }
    : { _tag: 'Handled', handled: method.answered(row, request, event, at) };
};

export const doubted = (row: ProtocolRow, event: Extract<ClientEvent, { readonly _tag: 'Uncertain' }>): readonly Handled[] => {
  const doubts: Handled[] = [];
  let standing = row;
  for (const request of event.requests) {
    if (request.meaning !== 'extension') continue;
    const doubt = declared(answering, request.method)?.doubted?.(standing, request);
    if (doubt === undefined) continue;
    doubts.push(doubt);
    standing = doubt.row;
  }
  return doubts;
};

export const refusal = (event: Settlement): GateRefusal | null => {
  const request = event.request;
  return request.meaning === 'extension' ? (declared(answering, request.method)?.refusal ?? null) : null;
};
