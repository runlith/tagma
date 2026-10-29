---
id: 01a14c08-8336-7b3c-965a-b08f2e1bad5a
title: Agent publishes a page hosted by the server, and it stands in the thread's feed as a live card
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b08cea36cd32
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/pages/PageCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/pages.feed.svelte
  - kind: file
    ref: apps/tagma/server/src/composition/http/artifacts.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/artifacts.ts
  - kind: symbol
    ref: apps/tagma/server/src/artifacts/storage.ts
    symbol: VersionedShelf
---
**Value.** A report, plan, dashboard, or motion that must be looked at rather than scrolled in the transcript is published by the agent as a page held by the server itself, standing in the thread's feed as a live card — where it was discussed.

**How.** The agent loads the built-in `artifacts` skill, writes the page as one HTML file, and publishes it with the `publish_artifact` tool. The feed draws a successful call as a card: title, description, version time, the page itself, and acts — open in the panel next to the thread, open in the system browser, copy the address.

**Behaviour.**
- The file path is the page's identity: republishing the same path replaces the page at the same address and keeps a bounded count of older versions; another path gets a new address.
- The card shows the version its call published. When the page is republished, older cards fold into a "replaced by a newer version" row and open into their own version; a version the shelf no longer holds is drawn as a "version not stored" card with a jump to the current one.
- The document stands in the card as a fixed-height preview that does not steal the feed's scroll: a click opens it in the panel. A page that declared a timeline plays in the card on its own in its proportion, with a player below: pause, frame slider, repeat, frame step with arrows, fullscreen; the slider frame is the same frame the server captures.
- A page in a card lives in a sandbox with no origin of its own; from a phone it loads through the remote door, and copying yields the door's address.
- The title comes from `<title>` unless the agent named the page itself; the description is one row for listings.
- The page is served with exactly the bytes lying in the file, under a CSP: scripts and styles only from a few CDNs and Google Fonts, no network requests, not even to the server itself. So the same file opens from disk and forwards as is.
- The skill tells the agent that the operator sees the page as a card and the link need not be repeated, while a link goes where the card does not reach. The skill does not let the agent look at the document with a browser; the agent checks motion before publishing with frames the server captures (`read_artifact_frames`, the `motion` skill).

**Limits.** Only a file already lying on the server disk is published; an empty or missing file is a refusal. Cards are drawn by native threads and the Tagma agent on ACP; terminal CLIs do not get `publish_artifact`. A fallen call and records published before the card stay a plain tool row. A page cannot be deleted, by operation or from the app.
