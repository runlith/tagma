---
id: 01a147a6-e8bd-7507-bf1c-2a1c0ce24592
title: "Lazy tag-declaration delivery: one \"when to create\" line at start, full declaration when a block of the tag is touched"
ord: 180
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Opportunity: at thread start a tag stands as a single "when to create" line, and the full declaration arrives on the first read or write of a block with that tag — server delivery, like `code` rules and explanations, with a `tag-unread` refusal for writing without a read declaration.

Why deferred: the dictionary is about 7% of the first thread request in runlith (19.5k characters, ~5k tokens), while the mechanism needs a delivery field on sections, splitting of every delivered text, a new refusal, a single delivery journal, and a separate mode for external CLIs. First the dictionary is squeezed by editing texts ([[58fd0444]]).

What decides: if after squeezing the dictionary grows again (a project's own tags, new catalogs) and starts telling on start — the `read_agent` measurement and the start-cost card ([[1ce2ba9f]]).
