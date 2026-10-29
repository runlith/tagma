---
id: 01a18501-a14a-7319-9e56-55febacf0e35
title: Agent navigation follows the operator's domain lists
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: discovered-from
    to: 01a184ec-d6e7-704a-aca7-fdeb14dc7d30
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04644096201b
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/page.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/profiles.ts
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/domains.ts
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/pages.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/navigation.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/restrictions.ts
---
**Value.** The operator limits the sites an agent can navigate to, including a site hop suggested by a page, without limiting the operator's own browsing.

**How.** The blocked and allowed domain lists in Settings → Browser, declared per user and project. A project list replaces its user list, including an empty list. A hostname matches exactly; a wildcard prefix matches its subdomains. Blocked wins over allowed; an empty allowed list permits any domain not blocked.

**Behaviour.** Agent opens, direct navigation and actions share a host-side pre-request gate for main documents, frames, redirects and new or reused related windows. A refusal names the destination domain and the deciding setting. Named-window lookup can reach an opener, sibling or descendant, so policy changes cover that related family while independent roots retain their state. The policy remains until a new agent policy or operator input/navigation clears the family; a block arriving after an action's answer remains unloaded and is surfaced once at the next agent action. With no page protected in the profile, empty lists add no interception, target pausing or host-gate calls.

**Limits.** The lists govern HTTP(S) Document navigation. Non-network documents (`blob:`, `data:`, `about:`), page fetches and other subresources are outside them; later HTTP(S) navigation is still gated. While any restricted page exists, managed Chromium intercepts Document requests across that profile, and the desktop partition's one request listener also sees unrestricted pages before passing them through. Workers are not intercepted or paused.
