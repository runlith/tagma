---
id: 01a10c5b-4903-7e93-bf59-f4f8da1db44a
title: "A session cannot land binary files it wrote: submit_work records only text, commit_checkout fails on a missing service"
ord: 102
tags: ["reflection"]
fields:
  {
    "actual": "produces answered \"not read, nothing recorded: holds bytes that are not text\"; submit_work answered \"paths named no file this session holds\"; commit_checkout failed with \"Service not found: tagma/workspace/CheckoutJudgement\"; a bare git commit is refused by the shell guard. The four icons stay untracked.",
    "command": "bash with produces naming four new PNGs under apps/tagma/app/static; submit_work paths=[icon-192.png]; stage_checkout + commit_checkout",
    "expected": "The PNGs this session rendered land in a commit, by submit_work or by stage_checkout + commit_checkout."
  }
---
Filed from project `runlith`.

Task 3db4ab5a (mobile shell PWA icons). Files: apps/tagma/app/static/{apple-touch-icon,icon-192,icon-512,icon-maskable-512}.png, ~18 KB total. The manifest committed in 0ff24ee69a references them.