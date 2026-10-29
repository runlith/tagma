---
id: 01a14c08-1c3f-7bde-a2e3-04722a082541
title: An agent browser step shows in the feed as a page card with a screenshot and a Show button
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/ToolCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/browserTools.feed.svelte
---
**Value.** Reading the feed, the operator sees on which page and what the agent did, and opens that page with one press.

**How.** A feed-thread step card for each browser page operation.

**Behaviour.** The card shows the page title or URL, the action, the element link, and the URL; an action sequence lists its steps in order, marking completed steps, the step that opened a dialog, and steps not run. A screenshot card shows the image itself. The Show button opens the page in the browser panel. A refusal shows its reason above the card, including the stopping step and completed count for a sequence.

**Limits.** Malformed call inputs fall back to the generic renderer so their refusal and original input remain inspectable. Profile and cookie operations go through a shared tool card.
