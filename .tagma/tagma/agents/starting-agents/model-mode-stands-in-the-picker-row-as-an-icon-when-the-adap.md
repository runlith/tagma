---
id: 01a170c3-635d-7ff8-a127-959607c13b1c
title: Model mode stands in the picker row as an icon when the adapter gave it one; a switch without an icon does not enter the picker
ord: 10
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/shared/models/choice.ts
    symbol: togglesOf
  - kind: symbol
    ref: packages/llm/src/models/description.ts
    symbol: ModelSwitch
---
A model switch is a value the adapter declares on the model (`ModelSwitch`). In the picker it stands as an icon in the model row, after the reasoning rungs, only when the adapter gave it an `icon` (SVG, like the provider sign) and it has exactly two values: the second is "on". The row itself draws the icon, so the picker knows no provider by name, and a new adapter with a similar mode lands in the row with no app change.

Icons go to modes that change a turn's speed or price and that a human picks with the model: Fast on OpenAI and Devin (`SPEED_SWITCH_ICON`). An enabled mode also shows in the model button in the input field, after the reasoning rung.

The row's icon shows the value the model itself stores: each model has its own mode memory, and reading the defaults returns it whole (`remembered`). Otherwise the row would show Fast as off while picking the model would enable it from memory. A mode picked on another model's row leaves with the pick and is remembered behind it. The current model's mode is written at once, and the row shows the thread's answer, not its own press: a refused write returns the old value.

A switch without an icon does not enter the picker. That is how Claude's "Thinking summary" left: it is not a model choice but how the feed is read, and its meaning does not read in the model row. Its value on the thread stays as it was, new threads take the adapter default; there is no separate settings place for such switches yet.
