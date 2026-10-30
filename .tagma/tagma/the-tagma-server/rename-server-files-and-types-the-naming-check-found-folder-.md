---
id: 01a18ede-d257-771b-b0f0-30b302c71a0d
title: "Rename server files and types the naming check found: folder-named files, types declared twice in a module, generic name heads"
ord: 181
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
The `server-names` check found 78 standing violations of the naming rule in `apps/tagma/server/src`: 2 files named after their folder (`graph/contract/service/services.ts`, `managed-browser/builds/build.ts`), 2 repeating their folder's word (`external-harnesses/sessions/sessionRead.ts`, `page-render/render.ts`), 35 exported types declared in two or three files of one module (`GitFailure`, `ThreadLive`, `Selection`, `Checker`…), and 3 names ending in a generic head (`AskData`, `CheckoutPathService`, `makeCheckoutPathService`). A pair of same-named types is either one concept, declared once in the lowest file and imported, or two concepts, each named by what it is. A file moves in one commit with nothing else changed but its imports, so its debt follows it; its contents are renamed in the next.