import { Collection } from '@runlith/primitives/collection.svelte';
import { getContext, setContext, untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

const CONTEXT = Symbol('command-listing');

export class Listing {
  readonly collection = new Collection(() => ({ highlighting: 'descendant' }));
  count = $state(0);
  inputs = $state(0);
  query = $state('');

  constructor(readonly id: string) {}

  static make(id: string): Listing {
    return setContext(CONTEXT, new Listing(id));
  }

  static use(): Listing {
    const listing = getContext<Listing | undefined>(CONTEXT);
    if (listing === undefined) throw new Error('A command part stands outside a command root');
    return listing;
  }

  readonly counted: Attachment<HTMLElement> = () => {
    untrack(() => (this.count += 1));
    return () => untrack(() => (this.count -= 1));
  };
}
