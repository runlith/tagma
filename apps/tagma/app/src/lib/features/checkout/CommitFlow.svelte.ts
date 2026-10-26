import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Refusal } from '$lib/wire/refusal.js';
import type { CheckoutRepo, PushAim } from './Repo.js';

type Checkouts = ReturnType<typeof CheckoutRepo.use>;

export type CommitAttempt = {
  readonly rootId: RootId;
  readonly message: string;
  readonly amend: boolean;
  readonly aim: PushAim | null;
};

const formatRefusal = (error: unknown): boolean => error instanceof Refusal && error.code.startsWith('format-');

export class CommitFlow {
  refused = $state<CommitAttempt | null>(null);

  constructor(private readonly repo: Checkouts) {}

  async run(attempt: CommitAttempt, withoutFormat: boolean, landed: () => void): Promise<void> {
    this.refused = null;
    try {
      await this.repo.commit.run(
        {
          rootId: attempt.rootId,
          message: attempt.message,
          amend: attempt.amend ? true : undefined,
          withoutFormat: withoutFormat ? true : undefined,
        },
        { throwOnError: true },
      );
    } catch (error) {
      if (formatRefusal(error)) this.refused = attempt;
      throw error;
    }
    landed();
    if (attempt.aim !== null) await this.repo.push.run(attempt.aim, { throwOnError: true });
  }
}
