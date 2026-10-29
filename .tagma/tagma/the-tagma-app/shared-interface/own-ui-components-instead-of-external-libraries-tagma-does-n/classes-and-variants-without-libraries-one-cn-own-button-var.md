---
id: 01a13d48-9aa9-71d0-a2d8-6905826b7939
title: "Classes and variants without libraries: one `cn`, own button variants and Tailwind custom variants, dead dependencies go away"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/app.css
  - kind: file
    ref: apps/tagma/app/src/lib/shared/utils.ts
  - kind: file
    ref: packages/primitives/src/cn.ts
  - kind: file
    ref: packages/utils/src/class.ts
---
**One `cn`** — in the app (`shared/utils.ts`). Only there is the token config for tailwind-merge; without it `cn('text-meta', 'text-muted-foreground')` confuses size with color.
- `packages/primitives/src/cn.ts` goes away with the kit's `clsx`/`tailwind-merge` dependencies. Kit hosts (`DialogHost`) set structure with inline styles and receive classes from the app.
- `packages/utils/src/class.ts` (zero consumers) goes away with the same dependencies of the utils package.
- The kit's `@source` in `app.css:19` is removed: there are no classes in the kit.

**Button variants.** `tailwind-variants` is replaced with an own `buttonVariants({ variant, size })` function and a `ButtonVariant` type of the same shape. They are also called outside `ui`: `providers/Group.svelte:194,224`, `threads/ColumnHead.svelte:127`, `speech/library/Again.svelte:79`, `threads/native/ChatButton.svelte:5`. The same is done for `input-group`. `tv` and `createTV` leave `shared/utils.ts`.

**shadcn css.**
- `@import 'shadcn-svelte/tailwind.css'` is replaced with own declarations in `app.css` — only the custom variants and utilities still used after the migration. The list is collected via `rg`; it includes `data-open:` and `no-scrollbar` (`command/command-list.svelte:11`).
- `providers/usageMenu.ts:2` moves to `data-[disabled]:`.
- The root worktree's final step does this together with removing the `shadcn-svelte` and `tw-animate-css` packages from `apps/tagma/app/package.json`. Until then the import stays.

**Removed immediately:** `lucide-svelte` from the root catalog.

**Rule 8183e6ef.** The exception text no longer mentions the shadcn CLI. The `**/ui/*/index.ts` pattern stays.

**Performer check:**
- `bun check`;
- token and re-export checks clean;
- `rg` for removed packages empty.
