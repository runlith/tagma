---
id: 01a1715a-0feb-7a87-b61b-0a2b6418cf23
title: A file from the system — image, PDF, anything — dropped on a CLI thread's terminal is pasted as a path the CLI will read
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17100-a232-7a0a-a781-94f0e2744109",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a17111-30e4-732c-a5ec-e0f64b005c71
---
A TUI like Claude Code takes a file the same way as an ordinary terminal: the dropped file becomes its path in the input line, and the CLI attaches the image by the path itself. Tagma's terminal used to understand only a path carried as text (`text/uri-list`), so a file from Finder never landed there.

The file's own path is used when desktop knows it and the server is on the same machine. Otherwise the file is copied unchanged into the thread's folder on the server, and the copy's path is pasted. Chat attachments do not fit here: they recompress images, check markdown, and accept only images, PDFs, and md.
