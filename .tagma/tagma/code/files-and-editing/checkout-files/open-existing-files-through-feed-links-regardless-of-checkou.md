---
id: 01a11b4e-c023-7698-8648-9ca859fcde59
title: Open existing files through feed links regardless of checkout
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11979-16fc-76b4-988c-8552009fb0ef",
    "status": "done"
  }
---
By the operator's direct word: any existing file on the server disk opens read-only in the app — text, markdown, pictures — regardless of project and owner. A relative path resolves from the thread's place, an absolute one as given. The feed makes a path a link only after confirming the file exists; a missing path stays text. Check opening a scratch report from the parent thread of foundation-refactor and the ×2 counter. Do not restart the working server. Result: f758e5f670; 9 UI tests, the path-resolution integration test, and the HTTP system test passed. An isolated browser stand with real components and an HTTP handler opened scratch markdown, PNG, and plain text; the missing path stayed text, one click opened one window. ×2 is the count of identical notices in Notices.push; the origin of the two source calls is not established. A full typecheck and the updated production-server check were not run; large pictures/PDFs on weak devices were not measured. The temporary stand is removed.
