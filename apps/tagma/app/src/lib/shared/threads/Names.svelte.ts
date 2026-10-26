import { Service } from '@runlith/layer/key';

export type OwnerWords = {
  readonly label: string;
  readonly archived: boolean;
  readonly harness: boolean;
  readonly home?: string | null;
  readonly projectId?: number;
};

export type AdoptedWords = { readonly thread: string; readonly label: string };

export class ThreadNames extends Service<ThreadNames>()('ThreadNames', { tier: 'project' }) {
  static make(): ThreadNames {
    return new ThreadNames(() => null);
  }

  constructor(private readonly words: (thread: string, project?: string) => OwnerWords | null | undefined) {
    super();
  }

  of(thread: string, project?: string): OwnerWords | null | undefined {
    return this.words(thread, project);
  }
}
