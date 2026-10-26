import type { Holder } from '@tagma/server/workspace/contract/wire/checkout';

const YOU = 'You';

export type ThreadLabel = (threadId: string) => string | null;

export const threadName = (thread: string, labelOf: ThreadLabel): string => labelOf(thread) ?? thread.slice(0, 8);

export const holderName = (holder: Holder, labelOf: ThreadLabel): string =>
  holder.kind === 'operator' ? YOU : threadName(holder.thread, labelOf);
