---
id: 01a1a5f3-4df4-7cb1-98db-5d800f5ce29b
title: "A line of several values yields by wrapping: the name holds, a detail leaves whole, only the last detail fades at the line's end"
ord: 67
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15539-b1a3-752b-b184-94e0485790ef
  - kind: relates
    to: 01a17dfb-ed8a-7e10-aee9-fec32f21aee8
sources:
  - kind: file
    ref: packages/chat-ui/src/theme.css
  - kind: file
    ref: apps/tagma/app/src/lib/shared/PathText.svelte
---
Flexbox shrinks squeezable neighbours in proportion to their width, so two faded values side by side cut the name (an email to `name@gm`) while a long detail keeps most of the line, and the two fades meet mid-line as a hole. `data-line` makes priority structural instead: the container wraps onto a hidden second line one `1lh` high, so a child that does not fit leaves the line whole rather than shrinking to a sliver. Every child keeps its width up to the line's; the last child marked `data-yield` stands on a 6rem basis and grows only to its content, so it fades at the line's end and leaves once less than 6rem is free. Earlier `data-yield` children behave as words, because only the last element child is selected. `data-yield="start"` stands on a zero basis and is for a value before the name that gives way at the line's start (the directory before a file name in `PathText`).

Two conditions follow from wrapping. The container carries the line's largest text class, since `1lh` is its own line height and a taller child is clipped. Anything that must stay at every width — a time, an outcome, an action — stands outside the container: it would leave with the first child that wraps before it. The rules sit in `@layer components`, so a utility class on a child overrides them; children carry no flex or width classes.