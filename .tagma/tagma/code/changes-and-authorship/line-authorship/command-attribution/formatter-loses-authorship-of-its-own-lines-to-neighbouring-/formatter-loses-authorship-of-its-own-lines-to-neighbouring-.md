---
id: 01a14c6f-3d42-7f64-8c3b-e8381db399a1
title: Formatter loses authorship of its own lines to neighbouring commands
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Refusal lines-held: bun.lock picked without attribution and holds lines 01a14c68-ea98-7334-8861-317dd11a1f05. Recovery offers whole/taking with foreign lines or waiting for their holders; no way to take one known unheld line.",
    "command": "submit_work({\"subject\":\"Record native audio Effect test dependency\",\"paths\":[\"bun.lock\"]})",
    "expected": "Land the single unheld audio-darwin/effect-test line without taking 44 neighbouring watcher-delivery lines, which the record tells apart."
  }
---
Filed from project `runlith`.

Read_changes showed 44 watcher-delivery lines and 1 nobody line; git diff ties that single line to the already landed devDependency @runlith/effect-test at audio-darwin. The whole delivery passed in af163c65fb, no more held paths of its own remain, but the duty to land the bun install lock answer stays on this line. The remaining lock changes — the new @runlith/watch workspace and its dependencies — do not belong to this work and were not included.
