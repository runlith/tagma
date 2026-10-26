import { linksClick } from '@tagma/server/settings/contract/wire/links';
import { Host } from '@runlith/layer/Host';
import { type Resolver, Service } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import { Scope } from '@runlith/layer/Scope';
import type { TooltipOptions } from '@runlith/primitives/tooltip.svelte';
import { Claims } from '$lib/shared/Claims.svelte.js';
import { spellChord } from '$lib/shared/chordSpelling.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { SettingsRepo, writtenCatalog } from '$lib/features/settings/SettingsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { PaneContent } from '$lib/shared/panes/pane.js';
import type { Link, LinkAct, LinkHow, LinkIcon, LinkKind, LinkPlace, LinkWords } from './Link.js';
import { LinkRegistry } from './LinkRegistry.js';
import { pointed } from './linkTarget.js';

type Settings = ReturnType<typeof SettingsRepo.use>;

export type LinkAim = {
  readonly link: Link;
  readonly x: number;
  readonly y: number;
  readonly app: Resolver | undefined;
  readonly origin: Element | undefined;
  readonly click: LinkHow | undefined;
};

export type LinkStep = {
  readonly how: LinkHow;
  readonly words: string;
  readonly icon: LinkIcon;
  readonly keys: string;
  readonly run: () => Promise<void>;
};

export type LinkMenuShape = {
  readonly steps: readonly LinkStep[];
  readonly places: readonly LinkAct[];
  readonly copies: readonly LinkAct[];
};

export class Opening extends Service<Opening>()('Opening', { tier: 'app' }) {
  static *make() {
    const opening = new Opening(yield* LinkRegistry, yield* SettingsRepo, yield* Workspace, yield* Notices, yield* Host);
    const scope = yield* Scope;
    scope.defer(opening.listen(yield* Router));
    scope.defer(opening.follow());
    return opening;
  }

  private readonly apps = new Claims<Resolver>();

  aim = $state.raw<LinkAim | null>(null);

  constructor(
    private readonly kinds: LinkRegistry,
    private readonly settings: Settings,
    private readonly workspace: Workspace,
    private readonly notices: Notices,
    private readonly host: Host,
  ) {
    super();
  }

  attach(app: Resolver): () => void {
    return this.apps.take(app);
  }

  listen(router: Router): () => void {
    const anchorOf = (target: EventTarget | null): HTMLAnchorElement | null => {
      const anchor = target instanceof Element ? target.closest('a[href]') : null;
      return anchor instanceof HTMLAnchorElement && !anchor.hasAttribute('download') ? anchor : null;
    };
    const declared = (anchor: HTMLAnchorElement): Link | null => (this.host.kind === 'mobile' ? null : this.anchored(anchor.href));
    const route = (anchor: HTMLAnchorElement): Link | null => {
      const app = this.apps.current;
      return this.host.kind === 'mobile' || app === null || !routed(anchor, router) ? null : this.kinds.routed(app, anchor);
    };
    const clicked = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.altKey || event.shiftKey) return;
      const anchor = anchorOf(event.target);
      if (anchor === null) return;
      const modified = this.modified(event);
      const link = declared(anchor);
      if (link !== null) {
        event.preventDefault();
        void this.open(link, this.how(modified));
        return;
      }
      if (!modified || !routed(anchor, router)) return;
      event.preventDefault();
      const own = route(anchor);
      if (own !== null) {
        void this.open(own, 'beside');
        return;
      }
      const url = new URL(anchor.href);
      void router.goto(`${url.pathname}${url.search}${url.hash}`);
    };
    const context = (event: MouseEvent): void => {
      if (event.defaultPrevented) return;
      const anchor = anchorOf(pointed(event));
      if (anchor === null) return;
      const at = { x: event.clientX, y: event.clientY };
      const link = declared(anchor);
      if (link !== null) {
        event.preventDefault();
        this.menu(link, at);
        return;
      }
      const own = route(anchor);
      if (own === null) return;
      event.preventDefault();
      this.menu(own, at, undefined, anchor, 'full');
    };
    document.addEventListener('click', clicked);
    document.addEventListener('contextmenu', context);
    return () => {
      document.removeEventListener('click', clicked);
      document.removeEventListener('contextmenu', context);
    };
  }

  follow(): () => void {
    return $effect.root(() => {
      $effect(() => void this.click);
    });
  }

  get click(): LinkHow {
    const projectId = this.workspace.contextProject?.id;
    if (projectId === undefined) return 'beside';
    const entries = (writtenCatalog(this.settings, projectId) ?? this.settings.catalog.key(projectId).data)?.entries;
    return entries?.find((entry) => entry.id === linksClick.id)?.value === 'section' ? 'full' : 'beside';
  }

  modified(event: { readonly metaKey: boolean; readonly ctrlKey: boolean }): boolean {
    return this.host.apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  how(modified: boolean): LinkHow {
    const click = this.click;
    return modified === (click === 'beside') ? 'full' : 'beside';
  }

  anchored(href: string, here?: Resolver): Link | null {
    const app = here ?? this.apps.current;
    return app === null ? null : this.kinds.anchored(app, href);
  }

  knows(link: Link): boolean {
    return this.kinds.find(link.kind) !== undefined;
  }

  async open(link: Link, how: LinkHow, here?: Resolver): Promise<void> {
    const app = here ?? this.apps.current;
    const kind = this.kinds.find(link.kind);
    if (app === null || kind === undefined) return;
    const place = how === 'full' || this.host.kind === 'mobile' ? kind.full : (kind.beside ?? kind.full);
    try {
      await place.open(app, link as Link<never>);
    } catch (error) {
      this.notices.refusal(error);
    }
  }

  menu(link: Link, at: { readonly x: number; readonly y: number }, here?: Resolver, origin?: Element, click?: LinkHow): void {
    if (this.knows(link)) this.aim = { link, ...at, app: here, origin, click };
  }

  closeMenu(): void {
    this.aim = null;
  }

  shape(link: Link, here?: Resolver, click: LinkHow = this.click): LinkMenuShape | null {
    const app = here ?? this.apps.current;
    const kind = this.kinds.find(link.kind);
    if (app === null || kind === undefined) return null;
    const acts = this.kinds.itemsOf(link.kind).map((items) => ({ group: items.group, acts: items.acts(app, link as Link<never>) }));
    return {
      steps: this.steps(app, kind, link, click),
      places: acts.filter((one) => one.group === 'places').flatMap((one) => one.acts),
      copies: acts.filter((one) => one.group === 'copies').flatMap((one) => one.acts),
    };
  }

  tabbed(tab: PaneContent, here?: Resolver): LinkStep | null {
    const app = here ?? this.apps.current;
    const link = app === null ? null : this.kinds.tabbed(app, tab);
    const kind = link === null ? undefined : this.kinds.find(link.kind);
    return app === null || link === null || kind === undefined ? null : this.step(app, kind, link, 'full', this.click);
  }

  tip(link: Link | null, here?: Resolver): TooltipOptions {
    const app = here ?? this.apps.current;
    const kind = link === null ? undefined : this.kinds.find(link.kind);
    if (app === null || kind === undefined || link === null || this.host.touch) return { text: null };
    return {
      text: kind.what(app, link as Link<never>),
      hints: this.steps(app, kind, link, this.click).map((step) => ({ keys: step.keys, words: step.words })),
    };
  }

  private steps(app: Resolver, kind: LinkKind<never>, link: Link, click: LinkHow): readonly LinkStep[] {
    if (kind.beside === undefined) return [this.step(app, kind, link, 'full', click)];
    const other: LinkHow = click === 'beside' ? 'full' : 'beside';
    return [this.step(app, kind, link, click, click), this.step(app, kind, link, other, click)];
  }

  keys(modified: boolean): string {
    const apple = this.host.apple;
    return spellChord({ key: 'click', meta: modified && apple, ctrl: modified && !apple, alt: false, shift: false }, apple);
  }

  private step(app: Resolver, kind: LinkKind<never>, link: Link, how: LinkHow, click: LinkHow): LinkStep {
    const place: LinkPlace<never> = how === 'beside' ? (kind.beside ?? kind.full) : kind.full;
    const keys = this.keys(kind.beside !== undefined && how !== click);
    return { how, words: wordsOf(place.words, app, link), icon: place.icon, keys, run: () => this.open(link, how, app) };
  }
}

const routed = (anchor: HTMLAnchorElement, router: Router): boolean =>
  (anchor.target === '' || anchor.target === '_self') &&
  !anchor.relList.contains('external') &&
  !anchor.hasAttribute('data-sveltekit-reload') &&
  new URL(anchor.href).origin === router.url.origin;

const wordsOf = (words: LinkWords<never>, app: Resolver, link: Link): string =>
  typeof words === 'string' ? words : words(app, link as Link<never>);
