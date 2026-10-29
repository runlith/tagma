---
id: 01a0e569-e74b-7091-acaf-7c3c36fe47b5
title: "Package wave: testing"
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e533-8064-7d5a-81fb-ef815c9f98b7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
The `testing` card of section 7 part 2 ([[e4a0488f]]), with its vocabulary amendment [[1deb33b8]]. Owns this package's `modules` and `names` debt. Its order and waits-on edges follow section 6 ([[be799808]]) and are added with the package groups' schedule.

**Closing note.** No code change was needed: the card leaves the file map and names unchanged, and the entries already stand as the card asks.
- The `modules` map declares all five entries (`flush`, `jsdom-setup`, `mount-store`, `overrides`, `reactive`) with role `testing`. Only test code may import them, and a file under a testing entry is test code itself. So `primitives/src/testing.ts` and `query/src/testing.ts`, the only non-test importers, are allowed, which answers the card's risk. The vite configs name `@runlith/testing/jsdom-setup` as a setup-file string, not an import.
- The one platform condition, `browser` on `./overrides`, came from the platforms resolver's first reach (ccb3398688). `svelte` on `mount-store` and `reactive` is a toolchain condition, not a platform.
- The package holds no `modules` or `names` debt, and `#module` acc2829b stands with its claims unchanged.

**Waiting on platforms' stage 1 (3e810e46):**
- The card's acceptance, "a production import of any `@runlith/testing` entry refuses", is judged today by `modules` over its region only, which does not cover `apps/tagma/app` or `apps/tagma/desktop`. No app production file imports the package now. The app's closure is judged once platforms carries testing roles and replaces package-boundary's P0 (737498be).
- `checks/platforms.json` holds no testing roles yet.

**Card term the vocabulary lacks.** The card's module kind `tooling` has no counterpart in the `#module` vocabulary (kit, product, surface, substrate), so acc2829b carries no kind.