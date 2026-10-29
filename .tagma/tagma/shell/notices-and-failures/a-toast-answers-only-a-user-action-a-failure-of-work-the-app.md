---
id: 01a15099-abd6-7d56-85d4-049a2a197ac2
title: A toast answers only a user action; a failure of work the app started itself goes to its own place or the error list
ord: 2
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/notices
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCards.svelte
---
A toast is a refusal with a reason and a way out, an undo, or the outcome of an action the user just took; it has no counter of repeats. A failure of a background read, re-read, subscription, or write the app made without a user gesture is shown by the place whose data it is, and where there is no such place — `Notices.background` or `Failure.report` puts it in the error list.
