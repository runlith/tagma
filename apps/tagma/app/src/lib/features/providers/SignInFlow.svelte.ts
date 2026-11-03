import type { SignInMethod } from '@runlith/llm/oauth/vendor';
import type { LinkPort } from '$lib/shared/ExternalLinks.js';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { AccountsRepo } from './AccountsRepo.js';

type SignInBegun = NonNullable<Awaited<ReturnType<AccountsRepo['begin']['run']>>>;

export type SignInPending = Exclude<SignInBegun, { flow: 'adopted' }>;

export type SignInPlace = { readonly id: number; readonly name: string };

type CliPending = Extract<SignInPending, { flow: 'external-cli' }>;

export type SignInOutcome =
  | {
      readonly kind: 'signed';
      readonly label: string;
      readonly account: CliPending['account'];
      readonly execution: CliPending['execution'] | null;
    }
  | { readonly kind: 'failed'; readonly execution: CliPending['execution']; readonly retryAccount: string | undefined };

export const pendingWords = (pending: SignInPending): string =>
  pending.flow === 'loopback'
    ? 'Continue in your browser…'
    : pending.flow === 'external-cli'
      ? 'Finish signing in below…'
      : 'Waiting for sign-in…';

const LOOPBACK_POLL_MS = 2_000;
const DEVICE_POLL_MS = 4_000;

export class SignInFlow {
  pending = $state<SignInPending | null>(null);
  busy = $state<'begin' | 'complete' | 'cancel' | null>(null);
  code = $state('');
  place = $state<SignInPlace | null>(null);
  outcome = $state<SignInOutcome | null>(null);

  private account: string | undefined = undefined;
  private poll: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;

  constructor(
    private readonly accounts: AccountsRepo,
    private readonly notices: Notices,
    private readonly links: LinkPort,
    private readonly provider: () => string,
    private readonly options: { readonly signedIn?: () => void } = {},
  ) {}

  async begin(place: SignInPlace | null, method?: SignInMethod, reconnect?: string): Promise<void> {
    const mine = ++this.attempt;
    this.busy = 'begin';
    this.stopPoll();
    this.outcome = null;
    try {
      const started = await this.accounts.begin.run(
        { provider: this.provider(), projectId: place?.id, account: reconnect, method },
        { throwOnError: true },
      );
      if (!started || mine !== this.attempt) return;
      this.account = reconnect;
      this.code = '';
      if (started.flow === 'adopted') {
        this.pending = null;
        this.place = null;
        this.outcome = { kind: 'signed', label: started.label, account: started.account, execution: null };
        this.options.signedIn?.();
        return;
      }
      this.pending = started;
      this.place = place;
      if (started.flow === 'loopback' || started.flow === 'paste') this.links.open(started.authorizeUrl);
      if (started.flow !== 'paste' && started.flow !== 'key')
        this.startPoll(started.flow === 'loopback' ? LOOPBACK_POLL_MS : DEVICE_POLL_MS);
    } catch (error: unknown) {
      if (mine === this.attempt) this.notices.refusal(error);
    } finally {
      if (mine === this.attempt) this.busy = null;
    }
  }

  async complete(): Promise<void> {
    const pending = this.pending;
    if (pending === null) return;
    const mine = this.attempt;
    const standing = (): boolean => mine === this.attempt && this.pending === pending;
    this.busy = 'complete';
    try {
      const provider = this.provider();
      if (pending.flow === 'external-cli') {
        const read = await this.accounts.status.refresh({ throwOnError: true });
        if (read === undefined || !standing()) return;
        const row = read[provider]?.find((candidate) => candidate.account === pending.account);
        if (row?.pending === true) return;
        this.outcome =
          row === undefined || row.failed === true
            ? { kind: 'failed', execution: pending.execution, retryAccount: this.account }
            : { kind: 'signed', label: row.label, account: row.account, execution: pending.execution };
      } else {
        const result = await this.accounts.complete.run(
          { provider, account: this.account, code: pending.flow === 'paste' || pending.flow === 'key' ? this.code : undefined },
          { throwOnError: true },
        );
        if (!result || 'pending' in result || !standing()) return;
      }
      this.code = '';
      this.pending = null;
      this.stopPoll();
      if (this.outcome?.kind !== 'failed') this.options.signedIn?.();
    } catch (error: unknown) {
      if (!standing()) return;
      this.notices.refusal(error);
      this.pending = null;
      this.stopPoll();
    } finally {
      if (mine === this.attempt) this.busy = null;
    }
  }

  async cancel(): Promise<void> {
    const pending = this.pending;
    if (pending === null || this.busy === 'cancel') return;
    const mine = ++this.attempt;
    this.stopPoll();
    this.busy = 'cancel';
    try {
      if (pending.flow === 'external-cli')
        await this.accounts.cancel.run(
          { provider: pending.provider, account: pending.account, execution: pending.execution },
          { throwOnError: true },
        );
      if (mine !== this.attempt) return;
      this.pending = null;
      this.outcome = null;
    } catch (error: unknown) {
      if (mine !== this.attempt) return;
      this.notices.refusal(error);
      if (pending.flow === 'external-cli') this.startPoll(DEVICE_POLL_MS);
    } finally {
      if (mine === this.attempt) this.busy = null;
    }
  }

  dismiss(): void {
    this.outcome = null;
  }

  dispose(): void {
    this.attempt += 1;
    this.stopPoll();
  }

  private startPoll(everyMs: number): void {
    this.stopPoll();
    this.poll = setInterval(() => {
      if (this.pending !== null && this.busy === null) void this.complete();
    }, everyMs);
  }

  private stopPoll(): void {
    if (this.poll !== null) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }
}
