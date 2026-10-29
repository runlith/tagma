---
id: 01a13f63-559c-7cb3-89b6-c447897f9b4a
title: "Line-authorship reflections: foreign writes record on the session, one's own never does"
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c07b-7c98-8268-8eafbc5bc939",
    "status": "done"
  }
---
Fix the line-authorship reflections' explicit defects at the root:
- [[11a17b73]] and [[44b22409]]: another session's staged deletion records as this session's lines.
- [[762842e3]]: files a command wrote in a checkout from a foreign cwd are not attributed to the session.
- [[85fef8f6]]: the read-only `wc`/`date` command got someone else's HTTP tests as its unattributed paths.
- [[59b3dee9]]: an isolated typecheck attributed another session's installation-file deletion to the caller.
- [[5ef463b4]]: the hint names the operator as co-author of a file this session wrote alone.
- [[e961241e]]: `read_changes` binds the latest native turn to the old commit with the same bytes.

First check each against the current code for reproduction. A point whose fix needs a product decision (e.g. a different time-window attribution model) is not done — name it in the report instead. Proof is a contract test where a contract exists, and a landed commit; answered reflections go through answer_reflection.

Result: 11a17b73, 44b22409, 59b3dee9 fixed (782bd1ef92, 8c62ad2d7a), 5ef463b4 (490ca9ce48), e961241e (9b2e8e938d, 8c62ad2d7a). A second round by the operator's word: [[762842e3]] (fd2d006e23, 4395925244) — a command that may write measures the session's checkout from scratch, a foreign repository when its path is named; [[85fef8f6]] (fd2d006e23, 4395925244, a167d6b068) — a provably reading line (`shellReadsOnly`) is never a writer candidate, overlap lands only on commands whose life covered the write, and the receipt no longer claims that session commands changed the paths. Writing through a process without OS privileges is invisible, so "never wrote" is proven by parsing the command line; a command parsing never proves is still judged by time, as before.
