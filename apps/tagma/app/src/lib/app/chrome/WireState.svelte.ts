import { ACCESS_REFUSALS, DEVICE_REVOKED_CLOSE, type AccessRefusal } from '@tagma/server/remote/contract/wire/access';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection, type LiveStatus } from '$lib/wire/Live.js';

export function accessRefusal(code: string): AccessRefusal | null {
  return ACCESS_REFUSALS.find((refusal) => refusal === code) ?? null;
}

export class WireState extends Service<WireState>()('WireState', { tier: 'app' }) {
  static *make() {
    return new WireState(yield* Live, yield* Scope);
  }

  status = $state<LiveStatus>('idle');
  opened = $state(false);
  downSince = $state<number | null>(null);
  refusal = $state<AccessRefusal | null>(null);

  constructor(
    private readonly connection: LiveConnection,
    scope: Scope,
  ) {
    super();
    scope.defer(
      connection.subscribeFailure((failure) => {
        if (failure.code === DEVICE_REVOKED_CLOSE) this.refusal = 'device-revoked';
      }),
    );
    scope.defer(
      connection.subscribeStatus((status) => {
        this.status = status;
        if (status === 'open') {
          this.opened = true;
          this.downSince = null;
        } else if (status === 'closed') this.downSince ??= Date.now();
        else if (status === 'refused') this.downSince = null;
      }),
    );
  }

  get live(): boolean {
    return this.status === 'open';
  }

  refuse(refusal: AccessRefusal): void {
    this.refusal = refusal;
    this.connection.refuse();
  }
}
