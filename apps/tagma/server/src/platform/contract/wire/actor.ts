import type { ThreadBornOf } from '@runlith/agent/protocol/birth';

import { NATIVE_HARNESS, sessionHarness, sessionToken, type SessionRef } from './session.js';

export type ChangeRecord = { readonly writer: SessionRef | null; readonly at: number };

export type ChangeActor =
  | { readonly kind: 'operator' }
  | { readonly kind: 'thread'; readonly threadId: string; readonly name: string | null }
  | { readonly kind: 'session'; readonly session: string };

export const changeActorOf = (writer: SessionRef | null, name: string | null = null): ChangeActor =>
  writer === null
    ? { kind: 'operator' }
    : sessionHarness(writer.harness) === NATIVE_HARNESS
      ? { kind: 'thread', threadId: writer.key, name }
      : { kind: 'session', session: sessionToken(writer) };

const actorWord = (actor: ChangeActor, reader: string | null): string =>
  actor.kind === 'operator'
    ? 'operator'
    : actor.kind === 'session'
      ? `session ${actor.session}`
      : actor.threadId === reader
        ? 'you'
        : `[[${actor.threadId}${actor.name === null ? '' : `|${actor.name}`}]]`;

export const changedBy = (actors: readonly ChangeActor[], reader: string | null): string => {
  const words = [...new Set(actors.map((actor) => actorWord(actor, reader)))];
  if (words.length === 0) return '';
  return ` by ${words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`}`;
};

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
  | { readonly kind: 'external'; readonly name: string; readonly plugin: string | null };

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
