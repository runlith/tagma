import type { ThreadBornOf } from '@runlith/agent/protocol/birth';

import { NATIVE_HARNESS, sessionToken, type SessionRef } from './session.js';

export const OPERATOR_PRINCIPAL = 'operator';

export type Actor =
  | { readonly kind: 'operator'; readonly deviceId?: string }
  | {
      readonly kind: 'thread';
      readonly threadId: string;
      readonly projectId: number;
      readonly principalId: string;
      readonly session: SessionRef;
      readonly act?: ThreadBornOf;
    }
  | {
      readonly kind: 'session';
      readonly session: SessionRef;
      readonly projectId: number | null;
    }
  | { readonly kind: 'external'; readonly name: string };

export type ActorRef =
  | { readonly kind: 'operator' }
  | { readonly kind: 'thread'; readonly threadId: string; readonly projectId: number }
  | { readonly kind: 'session'; readonly session: SessionRef; readonly projectId: number };

export const actorRefOf = (actor: Actor): ActorRef | null =>
  actor.kind === 'operator'
    ? { kind: 'operator' }
    : actor.kind === 'thread'
      ? { kind: 'thread', threadId: actor.threadId, projectId: actor.projectId }
      : actor.kind === 'session' && actor.projectId !== null
        ? { kind: 'session', session: actor.session, projectId: actor.projectId }
        : null;

export const signerPrincipal = (actor: Exclude<Actor, { readonly kind: 'operator' }>): string =>
  actor.kind === 'thread' ? actor.principalId : actor.kind === 'external' ? `external.${actor.name}` : actor.session.harness;

export const threadIdOf = (actor: Actor): string | null => (actor.kind === 'thread' ? actor.threadId : null);

export const nativeThreadIdOf = (actor: Actor): string | null =>
  actor.kind === 'thread' && actor.session.harness === NATIVE_HARNESS ? actor.session.key : null;

export const birthOf = (actor: Actor): { readonly createdBy: string; readonly askedBy?: string; readonly bornOf?: ThreadBornOf } =>
  actor.kind === 'operator'
    ? { createdBy: OPERATOR_PRINCIPAL }
    : actor.kind === 'thread'
      ? { createdBy: actor.threadId, askedBy: actor.threadId, bornOf: actor.act }
      : { createdBy: actor.kind === 'session' ? sessionToken(actor.session) : `external.${actor.name}` };
