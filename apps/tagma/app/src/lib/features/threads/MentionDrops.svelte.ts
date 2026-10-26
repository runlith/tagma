import { Service } from '@runlith/layer/key';
import type { ComposerDropState } from '@runlith/chat-ui/composer';
import { lift, type Point } from '$lib/shared/lift.js';
import type { Beyond } from '$lib/shared/Reorder.svelte.js';

export type Mention = { readonly name: string; readonly title: string };

export type MentionZone = {
  readonly covers: (under: Element) => boolean;
  readonly own: () => string | null;
  readonly holds: (name: string) => boolean;
  readonly mention: (mentions: readonly Mention[]) => void;
};

export type MentionGhost = { readonly at: Point; readonly label: string; readonly aimed: boolean };

const THRESHOLD_PX = 5;
const NONE: readonly Mention[] = [];

export class MentionDrops extends Service<MentionDrops>()('MentionDrops', { tier: 'app' }) {
  static make() {
    return new MentionDrops();
  }

  carried = $state.raw<readonly Mention[]>(NONE);
  aimed = $state<string | null>(null);
  ghost = $state.raw<MentionGhost | null>(null);
  private readonly zones = new Map<string, MentionZone>();

  add(id: string, zone: MentionZone): () => void {
    this.zones.set(id, zone);
    return () => {
      if (this.zones.get(id) !== zone) return;
      this.zones.delete(id);
      if (this.aimed === id) this.aimed = null;
    };
  }

  at(under: Element): string | null {
    for (const [id, zone] of this.zones) if (zone.covers(under)) return id;
    return null;
  }

  accepts(id: string, mentions: readonly Mention[]): boolean {
    const zone = this.zones.get(id);
    return zone !== undefined && this.fresh(zone, mentions).length > 0;
  }

  fresh(zone: MentionZone, mentions: readonly Mention[] = this.carried): readonly Mention[] {
    const own = zone.own();
    return mentions.filter((mention) => mention.name !== own && !zone.holds(mention.name));
  }

  stateOf(id: string, zone: MentionZone): ComposerDropState | null {
    if (this.fresh(zone).length === 0) return null;
    return this.aimed === id ? 'aimed' : 'ready';
  }

  follow(mentions: readonly Mention[], aimed: string | null): void {
    if (mentions.length !== this.carried.length || mentions.some((mention, at) => mention.name !== this.carried[at]?.name)) {
      this.carried = mentions.length === 0 ? NONE : mentions;
    }
    this.aimed = aimed;
  }

  mention(id: string, mentions: readonly Mention[]): void {
    const zone = this.zones.get(id);
    if (zone === undefined) return;
    const fresh = this.fresh(zone, mentions);
    if (fresh.length > 0) zone.mention(fresh);
  }

  carry(mentions: readonly Mention[], at: Point): void {
    const under = document.elementFromPoint(at.x, at.y);
    const zone = under === null ? null : this.at(under);
    const aimed = zone !== null && this.accepts(zone, mentions) ? zone : null;
    this.follow(mentions, aimed);
    const label = mentions.length === 1 ? (mentions[0]?.title ?? '') : `${mentions.length} mentions`;
    this.ghost = { at, label, aimed: aimed !== null };
  }

  drop(): boolean {
    const zone = this.aimed;
    const mentions = this.carried;
    this.leave();
    if (zone === null) return false;
    this.mention(zone, mentions);
    return true;
  }

  leave(): void {
    this.ghost = null;
    this.follow(NONE, null);
  }

  beyond<K>(mentionOf: (id: K) => Mention | null): Beyond<K> {
    return {
      follow: (id, at) => {
        const mention = id === null ? null : mentionOf(id);
        if (mention !== null) this.carry([mention], at);
        else if (this.ghost !== null) this.leave();
      },
      drop: () => this.drop(),
    };
  }

  press(event: PointerEvent, mention: () => Mention | null, lifted: () => void): void {
    if (event.button !== 0 || this.ghost !== null) return;
    let carried: Mention | null = null;
    lift(event, {
      threshold: THRESHOLD_PX,
      lift: () => {
        carried = mention();
        if (carried === null) return false;
        lifted();
        return true;
      },
      move: (at) => {
        if (carried !== null) this.carry([carried], at);
      },
      drop: () => void this.drop(),
      cancel: () => this.leave(),
    });
  }
}
