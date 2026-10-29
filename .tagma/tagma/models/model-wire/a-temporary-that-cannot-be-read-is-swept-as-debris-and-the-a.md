---
id: 01a0c98e-5786-7507-8bf8-f5383827f88a
title: A temporary that cannot be read is swept as debris, and the adopted-name comparison built two ways can miss the file it means
ord: 60
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c8cb-0492-7875-a673-8f56016d6004
---
Found reviewing [[016d6004]]'s second fix (`6bbd974094`), which made `replace` spare the adopted temporary when it carries this process id.

**A temporary that fails to READ is deleted, not only one that fails to parse.** `readTemporary` maps an unreadable file — EACCES, EIO, EMFILE — and a parse error alike to `null` (`packages/llm/src/oauth/CredentialFile.ts:182-188`), and the sweep then unlinks every path that is not the single newest (`:161-165`). So a rotation that cannot be read right now, for a transient reason or a permission one, dies before any write — the last copy of the credential, with the sweep's own predicate unable to tell "not my document" from "cannot tell right now". `FileTokenStore.test.ts:402` documents only the unparseable case as the intent.

**A latent identity gap in the comparison this commit added.** `adopted.includes(claimed)` (`:236`) compares a concatenated name against reconcile's path (`:205`), which is built with `join`. The two are equal only for already-normalized paths, and every caller passes a `join`-derived path (`apps/tagma/server/src/http/main.ts:70,153`, `apps/tagma/server/src/harness/captureDriver.ts:55`), so the name being compared is not the file being decided about. Today the store's own construction keeps them equal by luck of construction, not by contract.

**A misreport that exists twice, with a revert beside it.** `stamp()` after a successful rename (`:267`) and `removeAdopted` after a successful write (`:58-59`, `:83`) both fail after the bytes landed and still report `TokenStoreFailed`. Worse, if the surviving adopted temp is newer than the new live — the new test's own `+1s` future stamp, or clock skew — the next pass re-adopts it (`:109`, `:154`) and reverts live to the older document.

**Coverage the branch added:** no test exercises two failures in a row (adopted and alternate both standing) nor a throwing `removeAdopted`, so the alternate-name road is proven for the single failure only. The new test's recovery assertion also needs a margin — a stall over one second between the seed update and the failed write makes it adopt the wrong document and flake.

Fix at the owner: distinguish "not my document" from "cannot read it" in `readTemporary`'s answer, so the sweep's predicate stops deleting the second; compare paths the same way both sides build them; and decide whether a post-landing failure is reported as one.