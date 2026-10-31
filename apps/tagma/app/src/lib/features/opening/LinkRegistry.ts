import { type Resolver, Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import type { PaneContent } from '$lib/shared/panes/pane.js';
import { type Link, type LinkItems, type LinkKind, LinkKinds, LinkMenuItems, type LinkTab } from './Link.js';

type TabIndex = { readonly items: readonly LinkKind<never>[]; readonly tabs: ReadonlyMap<string, LinkTab<never>> };

export class LinkRegistry extends Service<LinkRegistry>()('LinkRegistry', { tier: 'app' }) {
  static *make() {
    return new LinkRegistry(yield* LinkKinds, yield* LinkMenuItems);
  }

  private indexed: TabIndex | undefined;

  constructor(
    private readonly kinds: Point<LinkKind<never>>,
    private readonly items: Point<LinkItems<never>>,
  ) {
    super();
  }

  private get tabs(): ReadonlyMap<string, LinkTab<never>> {
    const items = this.kinds.items;
    if (this.indexed?.items !== items) {
      this.indexed = {
        items,
        tabs: new Map(items.flatMap((kind) => (kind.tab === undefined ? [] : [[kind.tab.kind, kind.tab] as const]))),
      };
    }
    return this.indexed.tabs;
  }

  find(kind: string): LinkKind<never> | undefined {
    return this.kinds.find(kind);
  }

  anchored(app: Resolver, href: string): Link | null {
    for (const kind of this.kinds.items) {
      const link = kind.anchor?.(app, href) ?? null;
      if (link !== null) return link;
    }
    return null;
  }

  routed(app: Resolver, anchor: HTMLAnchorElement): Link | null {
    for (const kind of this.kinds.items) {
      const link = kind.route?.(app, anchor) ?? null;
      if (link !== null) return link;
    }
    return null;
  }

  tabbed(app: Resolver, content: PaneContent): Link | null {
    return this.tabs.get(content.kind)?.link(app, content.id) ?? null;
  }

  itemsOf(kind: string): readonly LinkItems<never>[] {
    return this.items.items.filter((items) => items.kind === kind);
  }
}
