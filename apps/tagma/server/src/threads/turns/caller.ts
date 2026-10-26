import type { AdmitCaller } from '@runlith/agent/thread/keyed';
import type { Actor } from '../../platform/contract/wire/actor.js';

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
