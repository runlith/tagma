import { Context } from 'effect';

export class GrantSigner extends Context.Service<
  GrantSigner,
  {
    grantFor(threadId: string): string;
    threadOf(grant: string): string | null;
  }
>()('tagma/platform/GrantSigner') {}
