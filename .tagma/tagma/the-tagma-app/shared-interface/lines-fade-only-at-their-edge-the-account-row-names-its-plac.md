---
id: 01a1a5dd-2a54-713f-8992-864e93052d8e
title: "Lines fade only at their edge: the account row names its place, and every multi-value row yields by priority"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a24c-35ac-72b7-a85f-5c52ce6cca3e",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf2a65d1a0a
  - kind: relates
    to: 01a15539-b1a3-752b-b184-94e0485790ef
---
Rows put a `FadeText` on every value, so flexbox shrinks each by its width and two fades meet mid-line. In the provider account row this cuts the email to `name@gm` while a generated `<data>/claude/<uuid>` path fills the line. The fix is a priority layout: the name holds its width, the values after it yield first, only the last one fades, and a fixed word fits or leaves. Machine strings stay off the row and are reached from its menu. The account row names its place in words, and the server marks a directory Tagma made, so the app never guesses from the path. Every other row where two values fade side by side gets the same layout.