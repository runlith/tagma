import { untrack } from 'svelte';
import { clashOf } from './RegistryClash';
import type { ChatHero, ChatInterlude, ChatPin, ChatRegions } from './surface';

type Held<M> = { readonly contributor: string; readonly mount: M };

class Mounts<M extends { readonly id: string }> {
  held = $state.raw<readonly Held<M>[]>([]);

  constructor(private readonly kind: string) {}

  add(contributor: string, mount: M): () => void {
    const held = untrack(() => this.held);
    const clash = held.find((one) => one.mount.id === mount.id);
    if (clash) throw clashOf(`Feed ${this.kind} "${mount.id}"`, clash.contributor, contributor);
    const entry: Held<M> = { contributor, mount };
    this.held = [...held, entry];
    return () => {
      this.held = untrack(() => this.held).filter((one) => one !== entry);
    };
  }
}

export class FeedRegions implements ChatRegions {
  private readonly interludeMounts = new Mounts<ChatInterlude>('interlude');
  private readonly pinMounts = new Mounts<ChatPin>('pin');
  private readonly heroMounts = new Mounts<ChatHero>('hero');

  interludes = $derived(this.interludeMounts.held.map((one) => one.mount));
  pins = $derived(this.pinMounts.held.map((one) => one.mount));
  heroes = $derived(this.heroMounts.held.map((one) => one.mount));

  interlude(contributor: string, item: ChatInterlude): () => void {
    return this.interludeMounts.add(contributor, item);
  }

  pin(contributor: string, item: ChatPin): () => void {
    return this.pinMounts.add(contributor, item);
  }

  hero(contributor: string, item: ChatHero): () => void {
    return this.heroMounts.add(contributor, item);
  }
}
