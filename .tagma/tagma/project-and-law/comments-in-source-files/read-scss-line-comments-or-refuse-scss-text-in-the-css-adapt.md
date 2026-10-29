---
id: 01a0c713-cc3d-792c-9b90-3fe19b1946d0
title: Read SCSS line comments, or refuse SCSS text, in the CSS adapter
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/source-comments/src/languages/css.ts
  - kind: file
    ref: packages/source-comments/src/languages/svelte.ts
---
`cssComments` in `packages/source-comments/src/languages/css.ts` tracks only `/* */` while `css.extensions` claims `.scss` and `svelteComments` hands every `<style>` region to it regardless of `lang`. `readComments('a.scss', '// why\n.a { color: red; }\n')` answers `{lexed: true, comments: []}` and the strip leaves the line — a shorter list, breaking the adapter contract that a construct the reader does not track refuses the file.

Fix at the owner: either track `//` to end of line for SCSS text (a `.scss` path and a Svelte style whose `lang` is `scss`/`sass`), keeping it out of strings and `url(...)`, or drop `.scss` from the adapter and make the Svelte reader refuse a non-CSS `lang` the way it refuses a foreign script type. Done when the reproduction above answers one comment (or an unlexable reason), the package tests cover it, and the limitation claim under this area is retired.