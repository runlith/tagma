import { Effect } from 'effect';
import { ToolFailed, type ToolAnswerOptions } from '../agent/tool';
import type { PermissionSubject, Raised } from '../permissions/vocabulary';
import type { ToolDisplay } from '../tool/display';
import type { Within } from './reach';
import type { ToolCaller } from '../agent/contracts';
import type { ThreadTarget } from '../thread/record';
import { recipientsTitle } from './agentLabel';
import type { ThreadActing, ThreadPlaneAccess } from './ThreadPlaneAccess';
import { causeSentence } from '../thread/persisted';
import { planeRefusalOf } from './planeRefusal';

export const addressee = (address: string, target?: ThreadTarget) => ({
  kind: 'agent' as const,
  address,
  id: target?.threadId,
  projectId: target?.projectId,
});

export type Recipient = { readonly address: string; readonly id?: string; readonly projectId?: number };

export const recipientsReference = (recipients: readonly Recipient[]) => ({ kind: 'agents' as const, recipients });

export function addressesOf(to: unknown): readonly string[] {
  if (typeof to === 'string') return to.length > 0 ? [to] : [];
  return Array.isArray(to) ? to.filter((address): address is string => typeof address === 'string' && address.length > 0) : [];
}

export const addressed = (to: string, subtitle?: string, target?: ThreadTarget): ToolDisplay => ({
  form: 'none',
  title: to,
  subtitle,
  reference: addressee(to, target),
});

export const addressedSoFar = (to: string | undefined, subtitle?: string): ToolDisplay =>
  to === undefined ? { form: 'none', subtitle } : addressed(to, subtitle);

export function crossingPrepared(
  access: ThreadPlaneAccess,
  caller: ToolCaller,
  writes: readonly PermissionSubject[],
  to: string,
  within: Within,
): Effect.Effect<
  { readonly subjects: readonly PermissionSubject[]; readonly raised: readonly Raised[]; readonly prepared: readonly Raised[] },
  ToolFailed
> {
  return hostCall(
    Effect.flatMap(access.acting(caller), (verbs) =>
      Effect.map(verbs.crossing({ to, within }), (raised) => ({ subjects: writes, raised, prepared: raised })),
    ),
  );
}

export function acting<A>(
  access: ThreadPlaneAccess,
  caller: ToolCaller,
  use: (verbs: ThreadActing) => Effect.Effect<A, unknown>,
): Effect.Effect<A, ToolFailed> {
  return hostCall(Effect.flatMap(access.acting(caller), use));
}

export function handed(to: readonly string[], text: string | undefined): ToolDisplay {
  return {
    form: 'message',
    title: recipientsTitle(to),
    text: text ?? '',
    reference: recipientsReference(to.map((address) => ({ address }))),
  };
}

export const told = (call: { readonly json?: boolean }, text: string): Pick<ToolAnswerOptions, 'text'> =>
  call.json === true ? {} : { text };

export function hostCall<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, ToolFailed> {
  return work.pipe(
    Effect.mapError((cause) => {
      if (cause instanceof ToolFailed) return cause;
      const refusal = planeRefusalOf(cause);
      return refusal === null
        ? new ToolFailed({ reason: causeSentence(cause) })
        : new ToolFailed({ code: refusal.code, reason: refusal.reason, unblock: refusal.unblock });
    }),
  );
}
