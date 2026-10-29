---
id: 01a14c08-1c3f-7bde-a2e3-046a6700af16
title: Operator picks a page element by clicking, and its description, image, and action link land in the thread field
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7595-7388-9467-c90f6d8a1c85
  - kind: relates
    to: 01a14bc0-75bb-73fc-8d6e-9df22504cfd8
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/pick/Picks.ts
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/pick.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/automation.ts
---
**Value.** The operator points the agent at an element instead of describing it in words: "this button" reaches the agent as an exact link.

**How.** The "Pick elements into the chat" button in the browser panel enables a picking mode with highlight under the cursor; Esc turns it off. Underneath is the live `browser.pick` feed.

**Behaviour.**
- Each click drops an "Element · …" Markdown document into the input field of the thread the operator last worked in: page and URL, a link for `act_on_page` without a new snapshot, role, name, tag, selector, bounding box, attributes, styles, text, and up to 2000 characters of HTML; the element's image arrives as an attachment. The chip and the document's opening heading share one title, kept whole and on one line so the thread accepts it as a named document.
- Development metadata from React, Svelte and Vue adds the component and the location the framework keeps. Existing absolute locations inside a registered checkout of the page's project, including a worktree, resolve to that checkout. For a loopback page whose serving terminal is known, relative paths and same-origin web URLs use its retained working directory as the candidate dev root, accepted only when the file exists in a checkout of this project. An unknown root or unmatched file remains marked unresolved. React's development stack reports a runtime location, and Vue's component file has no element line. When reading a React stack could invoke page formatting code, only the component name is added. Picking reads main-world metadata without enabling the Runtime domain or installing page-visible state.
- Picking reaches cross-site frames as well as the main document, including frames attached after picking begins. Agent captures and the element's picture temporarily lift the pick highlight from those frames and restore picking afterwards. Ending the feed ends picking throughout the page.
- Several elements can be picked in a row; the operator sends the message.

**Limits.** With no thread on screen, the element is not dropped anywhere, and the panel says so. Only an agent with browser tools ([[4096201b|agent-driven pages]]) can act on the link; for any other the link is only a description.
