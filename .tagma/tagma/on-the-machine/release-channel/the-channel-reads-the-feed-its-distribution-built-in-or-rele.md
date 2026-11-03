---
id: 01a17f40-df35-71ef-97b7-433d03248906
title: "The channel reads the feed its distribution built in or release.feed names: a withdrawn release leaves the offer, and a missing feed yields source-unreadable with the last feed read"
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1361b-0306-7539-b5f1-3cd46c675b20
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/feed.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/offers.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/places.ts
---
- **Address** — the feed address the distribution's descriptor names is built into its release as the `release.feed` fallback; the core's own descriptors name none, so their releases read only what `release.feed` is set to. An empty setting reads nothing and drops the offer of a feed read before. A feed that drops a withdrawn release removes it from the offer at the next read.
- **Reading** — at server start, every hour, and whenever the person checks (`check_for_updates`: Check for Updates… in the app menu, the status popover's ↻, `tagma release check`); so the channel answers `watched: true`. The hour bounds how late a running Tagma learns of a release; one read is a GET of a small file the host caches, so its cost on any machine is nil. A 404 answer — no published feed, or a closed place — is `source-unreadable`. A previously read feed stays in `update.json`, and the offer builds on it.
- **Only the feed's newest release is offered** — the newest entry this release can read, since the feed decodes per entry ([[c7e9bcae]]) — as the machine platform's archive ([[31a58388]]), and only when its number is above the running one: one standing on a withdrawn release sees "newest — the previous one" with no offer, and only `tagma release back` leads down.
