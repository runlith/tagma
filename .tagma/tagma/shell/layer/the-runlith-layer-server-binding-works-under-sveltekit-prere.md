---
id: 01a14291-0c7e-7f51-8c80-e0939b832357
title: "The @runlith/layer server binding works under SvelteKit prerender: App.handle does not read url.search"
ord: 36
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
A page prerender with SSR under `App.handle` from `src/sveltekit/server.ts` falls with a 500: `ServerLive` immediately builds the address via `requestUrl`, which reads `url.search`, forbidden by SvelteKit under prerender (`Cannot access url.search on a page with prerendering enabled`). Because of this the `apps/tagma/site` site is built with no SSR.

To do: the request address and everything SvelteKit withholds under prerender are read lazily, when loading asks for them, not when the request app opens. Per the twins rule the same goes into the twin package.

Done when the binding test shows a prerender request through `App.handle` served without error, and the site can switch SSR on.
