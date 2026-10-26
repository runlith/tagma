import { BLOCK_REF_INLINE } from '@tagma/server/graph/contract/wire/references';
import { THREAD_REF_INLINE } from '@tagma/server/threads/contract/wire/references';
import { PROJECT_REF_INLINE } from '@tagma/server/projects/contract/wire/references';
import type { Link, LinkFrom } from '$lib/features/opening/Link.js';
import { threadLink } from '$lib/features/presence/link.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';
import type { OwnerWords } from '$lib/shared/threads/Names.svelte.js';

export type RefKind = 'block' | 'thread' | 'project';

export type TextRef = { raw: string; kind: RefKind; target: string; label: string | undefined };

export function readRef(src: string): TextRef | undefined {
  const block = BLOCK_REF_INLINE.exec(src);
  if (block) return { raw: block[0], kind: 'block', target: (block[1] as string).toLowerCase(), label: block[2] };
  const thread = THREAD_REF_INLINE.exec(src);
  if (thread) return { raw: thread[0], kind: 'thread', target: (thread[1] as string).toLowerCase(), label: thread[2] };
  const project = PROJECT_REF_INLINE.exec(src);
  if (project) return { raw: project[0], kind: 'project', target: project[1] as string, label: project[2] };
  return undefined;
}

export type ThreadRefView = { text: string; dead: boolean; href: string | null; link: Link | null };

export function threadRefView(
  addresses: Addresses,
  id: string,
  label: string | null,
  words: OwnerWords | null | undefined,
  from?: LinkFrom,
): ThreadRefView {
  return {
    text: label ?? words?.label ?? id,
    dead: words === null,
    href: words === null || words?.home === null ? null : addresses.thread(id, words?.home),
    link: words === null ? null : threadLink({ threadId: id, projectId: words?.projectId }, from),
  };
}
