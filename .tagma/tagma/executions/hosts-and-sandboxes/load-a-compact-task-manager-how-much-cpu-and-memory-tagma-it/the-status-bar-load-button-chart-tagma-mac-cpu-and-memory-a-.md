---
id: 01a15ead-3b4d-7162-bd14-bd34c72ca8d3
title: "The status-bar load button: chart, Tagma/Mac CPU and memory; a card on hover instead of a text tooltip"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15e6d-3b62-7149-83a8-187dd16e7926",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c14dac7eb7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadButton.svelte
---
The load button showed the line "CPU 39% · 22 GiB · <thread> 18%", painted whole on any of the three alarms, and on hover gave a paragraph of text in a tooltip. Needed per the agreed layout (variant A): in the button — a 2-minute chart, "Tagma share/Mac share" CPU and Tagma memory; the alarm paints only the overloaded number. Hovering opens the card: what happened and the agents' share, CPU and memory scales, a chart in machine shares, background work, the three heaviest lines with a stop; click — the Load panel.
