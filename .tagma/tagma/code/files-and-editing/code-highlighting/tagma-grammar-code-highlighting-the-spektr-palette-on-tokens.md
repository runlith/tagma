---
id: 01a170de-397f-794e-8eaa-e72de2ced92c
title: "Tagma-grammar code highlighting: the 'Spektr' palette on tokens, gold caret, selection and current match"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a170c2-d64b-748f-ac94-0357562706e0",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/code-editor/src/extensions/theme.ts
  - kind: file
    ref: packages/highlight/src/colours.ts
---
The shiki themes `github-dark-default` and `github-light-default` lay keywords, strings, tags and parameters onto Tagma's state tones (failure, change, done, work): red, blue and green in code stop meaning signal. Replacement: one theme whose colors are `var(--syntax-*)` roles; the roles' values are `app.css` tokens, hues no closer than 21° to state tones. Highlighting stops depending on the window theme: the hue parameter leaves the kit, editor, markdown and app. In the editor the caret, selection and current search match are "you are here" gold, matches neutral, the "changed" stripe `--mutation`. The variant chosen by the operator from the "Code in Tagma" mockup.
