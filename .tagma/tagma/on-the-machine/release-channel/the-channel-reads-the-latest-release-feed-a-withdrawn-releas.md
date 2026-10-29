---
id: 01a17f40-df35-71ef-97b7-433d03248906
title: "The channel reads the Latest release feed: a withdrawn release leaves the offer, and a missing feed yields `source-unreadable` with the last feed read"
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
- **Address** — `releases/latest/download/feed.json` of the releases repository. GitHub serves the release file marked Latest and answers `no-cache`, so a new release is visible at the first read after publication, and a withdrawn one — a prerelease or a deleted one — leaves the offer as soon as Latest moves to the previous release.
- **Reading** — at server start and once a day; so the channel answers `watched: true`. A 404 answer — no published release with a feed, or a closed repository — is `source-unreadable`. A previously read feed stays in `update.json`, and the offer builds on it.
- **Only the feed's newest release is offered**, as the machine platform's archive ([[31a58388]]), and only when its number is above the running one: one standing on a withdrawn release sees "newest — the previous one" with no offer, and only `tagma release back` leads down.
