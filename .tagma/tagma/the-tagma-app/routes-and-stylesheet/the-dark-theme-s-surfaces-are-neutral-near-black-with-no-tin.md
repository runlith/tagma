---
id: 01a1661f-b314-7930-87f2-794af671eb5f
title: "The dark theme's surfaces are neutral near-black with no tint: colour in the window is carried by gold, states, projects and muted code highlight"
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165b3-4050-7292-999c-e1cf18dd9e6b
  - kind: relates
    to: 01a165d5-d5a5-785f-bfe2-a3acf0e82349
sources:
  - kind: file
    ref: apps/tagma/app/src/app.css
---
The previous dark theme was a blue-slate (tone 258°). That tone nearly matched the blue "waits for you" (264°) and dimmed the gold "you are here", so surfaces, text and muted greys are now saturation-free. Colour in the window is carried only by gold, state colours, project marks and muted code-highlight roles standing apart from state tones. A new surface or text token in `.dark` is also saturation-free, otherwise the background tone argues with the signals again.

A popup (`--popover`) parts from chrome and feed by a lightness step and a frame, not by a grey fill. A markedly lighter menu was rejected by the operator: on near-black it stood out as a grey spot.
