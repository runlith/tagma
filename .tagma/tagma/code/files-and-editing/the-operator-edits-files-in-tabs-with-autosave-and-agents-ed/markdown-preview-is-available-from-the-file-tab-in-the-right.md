---
id: 01a174d3-356f-7e60-bf57-4a7113bd48ee
title: Markdown preview is available from the file tab in the right area
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a174c0-b5e1-7b5a-9272-9d93c0a73486",
    "status": "done"
  }
---
FilePane didn't pass the preview action to FileTab. The shared PreviewTab is wired in: the button and Mod+Shift+V open Markdown in the same panel, going back leads to the source; Seen is bound to the file itself. PreviewTab receives projectId and onSource from the surface, so another project's file isn't read in the screen's project. The mounted scenario first failed on the missing button, after the fix passed on seeds 1/2/3: real Markdown, return in the panel, another project, and shortcut. All applicable of 19 rules without violations, independent review without findings. The shared app typecheck in the last run gave 32 errors of a parallel menu rework, with no diagnostics in the delivery's files. No live launch was run.
