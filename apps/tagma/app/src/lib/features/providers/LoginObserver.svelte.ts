import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { AccountsRepo } from './AccountsRepo.js';

export class LoginObserver extends Service<LoginObserver>()('LoginObserver', { tier: 'app' }) {
  static *make() {
    return new LoginObserver(yield* AccountsRepo, yield* Notices, yield* Scope);
  }

  constructor(
    private readonly accounts: AccountsRepo,
    private readonly notices: Notices,
    scope: Scope,
  ) {
    super();
    const stop = $effect.root(() => {
      $effect(() => {
        const focused = (): void => this.observe();
        window.addEventListener('focus', focused);
        return () => window.removeEventListener('focus', focused);
      });
    });
    scope.defer(stop);
  }

  private observe(): void {
    if (this.accounts.observe.pending) return;
    void this.accounts.observe.run(undefined, { throwOnError: true }).catch((error: unknown) => this.notices.background(error));
  }
}
