import type { PresenceRow } from '@tagma/server/threads/contract/wire/presence';

export type ComposerFace = {
  readonly thread: {
    readonly id: string | null;
    readonly projectId: number;
    readonly life: PresenceRow['status']['life'] | null;
  };
  readonly draft: {
    readonly text: string;
    readonly setText: (text: string) => void;
    readonly insert: (text: string) => void;
    readonly attach: (files: readonly File[]) => Promise<void>;
  };
  readonly send: () => Promise<boolean>;
};
