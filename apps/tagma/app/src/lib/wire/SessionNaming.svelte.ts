import { Service } from '@runlith/layer/key';
import type { SessionIdentity } from '@tagma/server/platform/contract/wire/session';

export class SessionNaming extends Service<SessionNaming>()('SessionNaming', { tier: 'app' }) {
  static *make() {
    return new SessionNaming();
  }

  identity = $state<SessionIdentity['Service']>({ prefix: {}, extras: [] });
}
