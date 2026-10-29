---
id: 01a184fc-26cd-79cd-b35b-d6231bc7df6f
title: Svelte development elements keep positions in the text given to the compiler
ord: 23
tags: ["research"]
fields:
  {
    "source": {
      "name": "Svelte",
      "ref": "svelte@5.57.3, published runtime and compiler sources"
    }
  }
---
Svelte 5.57.3's development template wrapper writes `element.__svelte_meta = { parent: dev_stack, loc: { file, line, column } }`. The location has a one-based line and a zero-based UTF-16 column in the text passed to `compile`; preprocessing can therefore change what those positions refer to. `file` comes from the compiler filename and can be made relative by `rootDir`. The parent stack describes component and block call sites, not a component function attached to the element; the component name is inferred from the location's filename. Production templates omit the location wrapper. Sources: [element writer](https://raw.githubusercontent.com/sveltejs/svelte/svelte@5.57.3/packages/svelte/src/internal/client/dev/elements.js), [compiler state](https://raw.githubusercontent.com/sveltejs/svelte/svelte@5.57.3/packages/svelte/src/compiler/state.js), [template emission](https://raw.githubusercontent.com/sveltejs/svelte/svelte@5.57.3/packages/svelte/src/compiler/phases/3-transform/client/transform-template/index.js). This is a source reading.