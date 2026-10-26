declare const HOLDER: unique symbol;

export type Holder = string & { readonly [HOLDER]: true };

const DRAFT = 'new:';

const SECTION = 'section:';

export const threadHolder = (threadId: string): Holder => threadId as Holder;

export const draftHolder = (projectId: number): Holder => `${DRAFT}${projectId}` as Holder;

export const sectionHolder = (surface: string): Holder => `${SECTION}${surface}` as Holder;

export const storedHolder = (stored: string): Holder => stored as Holder;

export const holderThread = (holder: Holder): string | null => (holder.startsWith(DRAFT) || holder.startsWith(SECTION) ? null : holder);
