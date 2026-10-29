---
id: 01a16a8d-caf5-79dc-a077-7e045f3283dd
title: "The icon counter is one badge in its corner: grey says “how many”, colour is a signal"
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165f0-b92e-7022-bbac-5ddefb22bd2d
  - kind: relates
    to: 01a16896-f474-7dbd-a7e8-99a7a6452b90
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/Badge.svelte
---
The number on an icon is how much of something is inside: tabs, working agents of the project, threads waiting for you. One `Badge` draws it: an 11 px plaque with a 10 px digit (`text-badge`) on the corner, not a number right of the icon. With no number beside, the header button stays a 28 px square, and the icon in it gets 16 px as on the rail. In the header the plaque crosses the button corner by 1 px: so it steps less onto the icon, and buttons stay even squares.

The badge tone speaks of signal, not of place. Grey (`plain`) is just "how many". Colour is what is worth a look: blue — new, not yet opened, or "waits for you"; orange (`stale`) — edits whose authorship could not be confirmed; red — failure; amber — work going. While there is no signal, the header is grey. No separate dot stands next to the counter: the badge tone carries its meaning. The dot stays only where there is no number, and the same `Badge` draws it (`dot`): a 6 px square in the signal's tone with the same gap. So the "This thread" button speaks of a new page, and the changes icon of unconfirmed paths.

A grey badge is painted in the button text colour (`bg-current`), so it lightens with the icon on hover, press and open popover. A coloured one keeps its colour: it is a signal, not part of the icon.

The badge hugs what it stands on and cuts a 2 px gap in it (`clip-path`) instead of drawing a ring around itself. A ring paints in one colour, while under the badge there is chrome, then hovered- or pressed-button backing, and on backing the ring read as a dark frame. The gap shows what is under the icon, in any state.
