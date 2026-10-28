import { Roster } from './Roster.svelte';
import type { ChatHero, ChatInterlude, ChatPin, ChatRegions } from './surface';

const subject =
  (kind: string) =>
  (id: string): string =>
    `Feed ${kind} "${id}"`;

const idOf = (mount: { readonly id: string }): string => mount.id;

export class FeedRegions implements ChatRegions {
  private readonly interludeMounts = new Roster<ChatInterlude>(subject('interlude'), idOf);
  private readonly pinMounts = new Roster<ChatPin>(subject('pin'), idOf);
  private readonly heroMounts = new Roster<ChatHero>(subject('hero'), idOf);

  get interludes(): readonly ChatInterlude[] {
    return this.interludeMounts.items;
  }

  get pins(): readonly ChatPin[] {
    return this.pinMounts.items;
  }

  get heroes(): readonly ChatHero[] {
    return this.heroMounts.items;
  }

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
