---
id: 01a17df9-6371-7b28-8a81-501ba5e88db1
title: "A step row and a notice hold the gist: event and label never yield to details"
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d50-35e2-7399-a78b-e6989933630b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17d65-7adb-7b72-8cdb-4f157ad14d20
---
A command-end notice showed "Co" instead of "Command completed": event words and the raw command line stood as two squeezable fields, and the server put the command line into the notice before the agent label. The same mechanism — an unbounded detail next to the gist — was found in the thread chip (child notices, notice group, step with addressees), in the queue reason and in the list-row path. The mockup is artifact `8c562ee36826`.
