---
id: 01a159d3-a015-7130-8839-20f99374316a
title: A hover popover takes no focus, closes after a pause on leave, and a click pins it open
ord: 20
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/primitives/src/popover.svelte.ts
---
Hover opening (`Popover.hover`) lives in the popover itself. Its conditions are held by all consumers, so they are not repeated outside.

- **Focus.** A hover-opened popover takes no focus. Otherwise a mouse passing over the rail would pull the keyboard out of the input field and the typed text would be lost.
- **Closing.** On pointer leave the popover closes with a pause. Returning to the trigger or to the popover itself lifts the pause. That lets the pointer reach the item off the straight line.
- **Focus on close.** When the focus was inside the popover (a button in it was pressed), it returns to the trigger. When outside, it is left alone. Otherwise a mouse leave would set focus onto the trigger.
- **Click.** A click on the trigger does not close a hover-opened popover but pins it: after that it closes only on an outside press, Escape, or focus leave. A keyboard click (`detail === 0`) also hands focus inside.
- **Holding from inside.** `hold()` makes the opening held, like a press, and hands focus to the content again. It is called by content that changed appearance inside an open popover: the Load panel over a load card would otherwise close on pointer leave, and focus from a vanished card button would fall out of the layer.
- **Opening from outside.** The hover mark lives until closing. An opening the owner makes itself via `open` holds like a press: otherwise a panel opened from elsewhere after a hover card closed would fade on pointer leave.
- **When it does not open.** Hover opens nothing while a button is held (dragging, selecting text) and while another closable layer stands open. Otherwise a second popover would grow over the menu.
- **Touch.** Touch has no hover: a popover opens and closes on tap.
