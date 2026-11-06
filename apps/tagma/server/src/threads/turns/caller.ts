import type { AdmitCaller } from '@runlith/agent/thread/keyed';
import { Effect } from 'effect';
import type { Actor } from '../../platform/contract/wire/actor.js';
import { PluginHost } from '../../plugin-host/contract/service/supervision.js';

export const admitCallerOf = (actor: Actor): AdmitCaller => {
  switch (actor.kind) {
    case 'operator':
      return { kind: 'reader' };
    case 'thread':
      return { kind: 'thread', threadId: actor.threadId };
    case 'external':
      return { kind: 'external', name: actor.name };
    case 'session':
      return { kind: 'external', name: `${actor.session.harness}:${actor.session.key}` };
  }
};

export const speakingCallerOf = Effect.fnUntraced(function* (actor: Actor) {
  const caller = admitCallerOf(actor);
  if (actor.kind !== 'external' || actor.plugin === null) return caller;
  const title = (yield* PluginHost).title(actor.plugin);
  return title === null ? caller : { ...caller, title };
});
