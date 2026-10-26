import Copy from '@lucide/svelte/icons/copy';
import Globe from '@lucide/svelte/icons/globe';
import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
import SquarePlus from '@lucide/svelte/icons/square-plus';
import { Router } from '@runlith/layer/Router';
import type { Link, LinkFrom, LinkItems, LinkKind } from '$lib/features/opening/Link.js';
import { Links } from './Links.svelte.js';
import { OpenPages } from './OpenPages.svelte.js';
import { BROWSER_PANE, shownOf } from './panes.js';

export const SITE_LINK = 'site';

export type SiteRef = { readonly url: string };

export const siteLink = (url: string, from?: LinkFrom): Link<SiteRef> => ({ kind: SITE_LINK, target: { url }, from });

const SYSTEM = 'Open in system browser';

const sites: LinkKind<SiteRef> = {
  kind: SITE_LINK,
  what: (_app, link) => link.target.url,
  beside: {
    words: (app) => (app.resolve(Links).panelled ? 'Open in built-in browser' : SYSTEM),
    icon: Globe,
    open: async (app, link) => {
      const pages = app.resolve(OpenPages).listing.byId;
      await app.resolve(Links).beside(link.target.url, { urlOf: (page) => pages.get(page)?.url, from: link.from });
    },
  },
  full: { words: SYSTEM, icon: SquareArrowOutUpRight, open: (app, link) => app.resolve(Links).system(link.target.url) },
  anchor: (app, href) => (/^https?:\/\//iu.test(href) && new URL(href).origin !== app.resolve(Router).url.origin ? siteLink(href) : null),
  tab: {
    kind: BROWSER_PANE,
    link: (app, id) => {
      const shown = shownOf(id);
      const page = shown === null ? undefined : app.resolve(OpenPages).listing.byId.get(shown.page);
      return page !== undefined && /^https?:\/\//iu.test(page.url) ? siteLink(page.url) : null;
    },
  },
};

const tabs: LinkItems<SiteRef> = {
  kind: SITE_LINK,
  order: 10,
  group: 'places',
  acts: (app, link) =>
    app.resolve(Links).panelled
      ? [
          {
            id: 'new-tab',
            words: 'Open in new browser tab',
            icon: SquarePlus,
            run: async () => {
              await app.resolve(Links).beside(link.target.url, { fresh: true, from: link.from });
            },
          },
        ]
      : [],
};

const copies: LinkItems<SiteRef> = {
  kind: SITE_LINK,
  order: 100,
  group: 'copies',
  acts: (_app, link) => [{ id: 'copy-link', words: 'Copy link', icon: Copy, run: () => navigator.clipboard.writeText(link.target.url) }],
};

export const links = [sites];

export const items = [tabs, copies];
