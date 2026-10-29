---
id: 01a13662-a8ac-727c-87fe-62058efbd666
title: read_performance accepts a limit whose answer is several times the tool envelope
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "overview with limit 200 answered 305 thousand characters (18 thousand lines), slow with limit 300 — 238 thousand characters; neither fit and both went to a file, jq had to parse them. Every line is a span's full JSON repeating all histogram boundaries (34 numbers per series).",
    "command": "read_performance {type:\"overview\", since, until, limit:200} and {type:\"slow\", name:\"CheckoutStatus.reading\", limit:300}",
    "expected": "The ceiling limit derives from the tool-output envelope and the measured line: an admissible limit gives an answer that fits the envelope."
  }
---
Filed from project `runlith`.

Cost in this session: five read_performance answers went to files (60–305 thousand characters) and needed separate bash+jq steps to fold. An overview line is nearly all boundariesMs and bucketCounts of 34 numbers, though the reader needs count, sumMs, p50, p99, and the top occupied bucket. A slow line is a full span with wallTime, monotonic clocks, and empty attributes. The default and ceiling of these reads ignore the real line weight, as the limit rule requires.
