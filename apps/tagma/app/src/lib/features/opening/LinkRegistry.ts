import { clashOf } from '@runlith/chat-ui/RegistryClash';
import { type Resolver, Service } from '@runlith/layer/key';
import type { PaneContent } from '$lib/shared/panes/pane.js';
import type { Link, LinkItems, LinkKind, LinksModule, LinkTab } from './Link.js';

export class LinkRegistry extends Service<LinkRegistry>()('LinkRegistry', { tier: 'app' }) {
  private readonly kinds = new Map<string, LinkKind<never>>();
  private readonly tabs = new Map<string, LinkTab<never>>();
  private readonly items = new Map<string, readonly LinkItems<never>[]>();

  constructor(modules: readonly LinksModule[]) {
    super();
    for (const module of modules) {
      for (const declared of module.links ?? []) {
        if (this.kinds.has(declared.kind)) throw clashOf(`Link kind "${declared.kind}"`, declared.kind, declared.kind);
        this.kinds.set(declared.kind, declared);
        const tab = declared.tab;
        if (tab === undefined) continue;
        const holder = [...this.kinds.values()].find((one) => one !== declared && one.tab?.kind === tab.kind);
        if (holder !== undefined) throw clashOf(`The link of tab kind "${tab.kind}"`, holder.kind, declared.kind);
        this.tabs.set(tab.kind, tab);
      }
      for (const items of module.items ?? []) this.items.set(items.kind, [...(this.items.get(items.kind) ?? []), items]);
    }
    for (const [kind, items] of this.items)
      this.items.set(
        kind,
        items.toSorted((one, two) => one.order - two.order),
      );
  }

  find(kind: string): LinkKind<never> | undefined {
    return this.kinds.get(kind);
  }

  anchored(app: Resolver, href: string): Link | null {
    for (const kind of this.kinds.values()) {
      const link = kind.anchor?.(app, href) ?? null;
      if (link !== null) return link;
    }
    return null;
  }

  routed(app: Resolver, anchor: HTMLAnchorElement): Link | null {
    for (const kind of this.kinds.values()) {
      const link = kind.route?.(app, anchor) ?? null;
      if (link !== null) return link;
    }
    return null;
  }

  tabbed(app: Resolver, content: PaneContent): Link | null {
    return this.tabs.get(content.kind)?.link(app, content.id) ?? null;
  }

  itemsOf(kind: string): readonly LinkItems<never>[] {
    return this.items.get(kind) ?? [];
  }
}
