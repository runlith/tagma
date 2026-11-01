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

  constructor(
    private readonly words: (thread: string, project?: string) => OwnerWords | null | undefined,
    private readonly readWords: (thread: string) => Promise<OwnerWords | null | undefined> = (thread) => Promise.resolve(words(thread)),
  ) {
    super();
  }

  read(thread: string): Promise<OwnerWords | null | undefined> {
    return this.readWords(thread);
  }

  of(thread: string, project?: string): OwnerWords | null | undefined {
    return this.words(thread, project);
  }
}
