import type { Link, LinkFrom } from '$lib/features/opening/Link.js';

export const THREAD_LINK = 'thread';

export type ThreadRef = { readonly threadId: string; readonly projectId?: number | undefined };

export const threadLink = (target: ThreadRef, from?: LinkFrom): Link<ThreadRef> => ({ kind: THREAD_LINK, target, from });
