---
id: 01a198f8-59a6-7cd1-ba21-e46f2638169d
title: Show submodule changes as repository references instead of file-read failures
ord: 155
tags: ["task"]
fields:
  {
    "holder": "tagma:01a198f5-fe8e-7f6f-94d1-e513385a1ee1",
    "status": "in_work"
  }
---
Fix read_authorship and the checkout diff so Git submodules compare commit references without reading directories as files. Cover staged, working, historical and uninitialized submodules through the app's operation door; show local changes as ordinary repository state.