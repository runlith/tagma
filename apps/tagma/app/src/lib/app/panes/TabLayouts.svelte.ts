import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { type PaneContent, type PaneOpening, sameContent, type SidePane } from '$lib/shared/panes/pane.js';
import type { Holder } from '$lib/shared/panes/holder.js';
import { PaneRegistry } from './PaneRegistry.js';

export type TabLayout = {
  readonly tabs: readonly SidePane[];
  readonly active: string | null;
  readonly open: boolean;
  readonly recent: readonly string[];
};

export type TabOpen = { readonly activate?: boolean; readonly agent?: boolean; readonly quiet?: boolean };

type Stored = TabLayout & { readonly at: number };

const PREFIX = 'tagma.tabs:';

const DAY_MS = 86_400_000;

export const KEPT_DAYS = 30;

export const KEPT_HOLDERS = 500;

export const EMPTY_LAYOUT: TabLayout = { tabs: [], active: null, open: true, recent: [] };

export class TabLayouts extends Service<TabLayouts>()('TabLayouts', { tier: 'project' }) {
  static *make() {
    const platform = yield* Platform;
    const layouts = new TabLayouts((yield* ProjectRung.Current).projectId, platform.storage.local, yield* PaneRegistry, Date.now);
    (yield* Scope).defer(() => layouts.release());
    return layouts;
  }

  private readonly written = new SvelteMap<Holder, TabLayout>();

  private readonly read = new Map<Holder, TabLayout>();

  private readonly watched = new Map<Holder, () => void>();

  constructor(
    readonly projectId: number,
    private readonly storage: PlatformStorage,
    private readonly kinds: PaneRegistry,
    private readonly now: () => number,
  ) {
    super();
    this.sweep();
  }

  layout(holder: Holder): TabLayout {
    return this.held(holder);
  }

  standing(holder: Holder, stands: (tab: SidePane) => boolean): TabLayout {
    const kept = this.held(holder);
    const tabs = kept.tabs.filter(stands);
    return tabs.length === kept.tabs.length ? kept : { ...kept, tabs, active: this.survivor(kept, tabs) };
  }

  prune(holder: Holder, stands: (tab: SidePane) => boolean): void {
    const kept = this.held(holder);
    const shown = this.standing(holder, stands);
    if (shown !== kept) this.write(holder, shown);
  }

  open(holder: Holder, content: PaneContent, how: TabOpen = {}): PaneOpening {
    const refusal = this.kinds.refusal(content, holder);
    if (refusal !== null) return { kind: 'refused', reason: refusal };
    const layout = this.held(holder);
    const activate = how.activate ?? true;
    const standing = content.id === null ? undefined : layout.tabs.find((tab) => sameContent(tab, content));
    if (standing !== undefined) {
      if (activate) this.write(holder, { ...layout, active: standing.key, open: true });
      return { kind: 'revealed', key: standing.key };
    }
    const tab: SidePane = {
      key: crypto.randomUUID().slice(0, 8),
      kind: content.kind,
      id: content.id,
      ...(how.agent === true ? { agent: true as const } : {}),
    };
    this.write(holder, {
      ...layout,
      tabs: [...layout.tabs, tab],
      active: activate ? tab.key : (layout.active ?? tab.key),
      open: activate ? true : layout.open && layout.tabs.length > 0,
    });
    return { kind: 'opened', key: tab.key };
  }

  close(holder: Holder, key: string): void {
    const layout = this.held(holder);
    if (!layout.tabs.some((tab) => tab.key === key)) return;
    const tabs = layout.tabs.filter((tab) => tab.key !== key);
    this.write(holder, { ...layout, tabs, active: this.survivor(layout, tabs) });
  }

  activate(holder: Holder, key: string): void {
    const layout = this.held(holder);
    if (!layout.tabs.some((tab) => tab.key === key) || (layout.active === key && layout.open)) return;
    this.write(holder, { ...layout, active: key, open: true });
  }

  point(holder: Holder, key: string, id: string | null): void {
    const layout = this.held(holder);
    const tab = layout.tabs.find((standing) => standing.key === key);
    if (tab === undefined || tab.id === id) return;
    this.write(holder, { ...layout, tabs: layout.tabs.map((standing) => (standing.key === key ? { ...standing, id } : standing)) });
  }

  move(holder: Holder, key: string, before: string | null): void {
    const layout = this.held(holder);
    const tab = layout.tabs.find((standing) => standing.key === key);
    if (tab === undefined || key === before) return;
    const rest = layout.tabs.filter((standing) => standing.key !== key);
    const at = before === null ? rest.length : rest.findIndex((standing) => standing.key === before);
    if (at < 0) return;
    this.write(holder, { ...layout, tabs: [...rest.slice(0, at), tab, ...rest.slice(at)] });
  }

  show(holder: Holder, open: boolean): void {
    const layout = this.held(holder);
    if (layout.open === open) return;
    this.write(holder, { ...layout, open });
  }

  carry(from: Holder, to: Holder): void {
    const layout = this.held(from);
    if (layout.tabs.length === 0) return;
    const tabs = layout.tabs.filter((tab) => this.kinds.refusal(tab, to) === null);
    this.write(to, { ...layout, tabs, active: this.survivor(layout, tabs) });
    this.forget(from);
  }

  touch(holder: Holder): void {
    const raw = this.storage.getItem(this.keyOf(holder));
    if (raw === null) return;
    const kept = this.held(holder);
    this.storage.setItem(this.keyOf(holder), JSON.stringify({ ...kept, at: this.now() } satisfies Stored));
  }

  release(): void {
    for (const stop of this.watched.values()) stop();
    this.watched.clear();
  }

  private held(holder: Holder): TabLayout {
    return this.written.get(holder) ?? this.restored(holder);
  }

  private restored(holder: Holder): TabLayout {
    const known = this.read.get(holder);
    if (known !== undefined) return known;
    const layout = this.parse(this.storage.getItem(this.keyOf(holder)), holder);
    this.read.set(holder, layout);
    this.watched.set(
      holder,
      this.storage.watch(this.keyOf(holder), (value) => this.written.set(holder, this.parse(value, holder))),
    );
    return layout;
  }

  private write(holder: Holder, next: TabLayout): void {
    this.held(holder);
    const active = next.active;
    const recent = [...(active === null ? [] : [active]), ...next.recent.filter((key) => key !== active)].filter((key) =>
      next.tabs.some((tab) => tab.key === key),
    );
    const layout = { ...next, recent };
    this.written.set(holder, layout);
    this.storage.setItem(this.keyOf(holder), JSON.stringify({ ...layout, at: this.now() } satisfies Stored));
  }

  private forget(holder: Holder): void {
    this.held(holder);
    this.written.set(holder, EMPTY_LAYOUT);
    this.storage.removeItem(this.keyOf(holder));
  }

  private sweep(): void {
    const prefix = `${PREFIX}${this.projectId}:`;
    const dated = this.storage.keys(prefix).map((key) => ({ key, at: this.stamp(this.storage.getItem(key)) }));
    const oldest = this.now() - KEPT_DAYS * DAY_MS;
    dated.sort((one, two) => two.at - one.at);
    dated.forEach((entry, place) => {
      if (entry.at < oldest || place >= KEPT_HOLDERS) this.storage.removeItem(entry.key);
    });
  }

  private stamp(raw: string | null): number {
    try {
      const at = (JSON.parse(raw ?? 'null') as Partial<Stored> | null)?.at;
      return typeof at === 'number' && Number.isFinite(at) ? at : 0;
    } catch {
      return 0;
    }
  }

  private parse(raw: string | null, holder: Holder): TabLayout {
    try {
      const stored = JSON.parse(raw ?? 'null') as Partial<Stored> | null;
      if (stored === null || typeof stored !== 'object') return EMPTY_LAYOUT;
      const tabs = (Array.isArray(stored.tabs) ? stored.tabs : []).flatMap((tab: Partial<SidePane> | null): SidePane[] => {
        if (typeof tab?.key !== 'string' || typeof tab.kind !== 'string') return [];
        if (tab.id !== null && typeof tab.id !== 'string') return [];
        const content = { kind: tab.kind, id: tab.id ?? null };
        if (this.kinds.refusal(content, holder) !== null) return [];
        return [{ key: tab.key, ...content, ...(tab.agent === true ? { agent: true as const } : {}) }];
      });
      const active =
        typeof stored.active === 'string' && tabs.some((tab) => tab.key === stored.active) ? stored.active : (tabs.at(-1)?.key ?? null);
      const recent = (Array.isArray(stored.recent) ? stored.recent : []).filter(
        (key): key is string => typeof key === 'string' && tabs.some((tab) => tab.key === key),
      );
      return { tabs, active, open: stored.open !== false, recent };
    } catch {
      return EMPTY_LAYOUT;
    }
  }

  private survivor(layout: TabLayout, tabs: readonly SidePane[]): string | null {
    if (layout.active !== null && tabs.some((tab) => tab.key === layout.active)) return layout.active;
    const last = layout.recent.find((key) => key !== layout.active && tabs.some((tab) => tab.key === key));
    if (last !== undefined) return last;
    const at = layout.tabs.findIndex((tab) => tab.key === layout.active);
    const after = layout.tabs.slice(at + 1).find((tab) => tabs.includes(tab));
    const before = layout.tabs.slice(0, Math.max(at, 0)).findLast((tab) => tabs.includes(tab));
    return (after ?? before ?? tabs.at(-1))?.key ?? null;
  }

  private keyOf(holder: Holder): string {
    return `${PREFIX}${this.projectId}:${holder}`;
  }
}
