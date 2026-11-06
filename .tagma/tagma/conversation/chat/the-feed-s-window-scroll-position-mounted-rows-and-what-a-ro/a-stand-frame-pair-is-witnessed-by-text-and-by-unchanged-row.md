---
id: 01a1b2b2-5b42-7928-8269-15a97f749fc0
title: A stand frame pair is witnessed by text, and by unchanged rows when no text spans both frames
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/stand/displacement.ts
---
The common delta of a frame pair comes from text sentinels visible in both frames, because text is what the reader tracks and it moves with its row's content. A page that misses frames during a fast scroll can carry every visible text out of view between two samples. In Linux CI 42291444931, WebKit painted no frame for 871 ms while an older page mounted, and a wheel moved the content 861 px. Such a pair still has a measurable delta when a row that kept its size and text is visible in both frames, so those rows witness it, and wheel conservation and the other judgements go on through it. Rows that disagree by more than the tolerance leave the pair unmeasured (`no-common-sentinel`), because an insertion between them makes no single delta true. Control calibration still requires text witnesses.