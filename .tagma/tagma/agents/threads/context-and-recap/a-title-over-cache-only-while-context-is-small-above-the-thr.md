---
id: 01a11150-5efa-728b-8d42-8521eb002f23
title: A title over cache only while context is small; above the threshold — an excerpt on a light model
ord: 2
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
The native auto-title (`ThreadNaming.hook`) and "Generate title" on a live snapshot ask their question over the whole step request, with no context-size bound. When the first message carries hundreds of thousands of tokens, the title question reads all of that cache: by the operator's estimate for Opus about $0.2 per 700k, and at a provider with no cache or no cache write — the whole input, on the order of $20. An excerpt of the operator's words (`titleContext`, up to `threads.titleCharacters`) costs pennies at any size and is barely worse for a name: the naming gist is already in the operator's words.

Option: a threshold setting ("Title warm cache limit", on the order of 30–50k tokens by default); above it both auto-title and "Generate title" go as an excerpt on the provider's light model (or `threads.titleModel`), below — as now, over the warm cache.

Decide before implementing: the threshold value itself and where to measure it from (context size in the thread's `contextReading` or the request snapshot's size); which providers truly write cache on the first request — unverified. Not accepted: the operator deferred it.
