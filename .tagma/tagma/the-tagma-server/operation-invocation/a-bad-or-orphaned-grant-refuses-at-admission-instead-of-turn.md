---
id: 01a1226c-43d6-7081-9948-5297ae0ac62b
title: A bad or orphaned grant refuses at admission instead of turning the call into the operator's
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a113e4-a4f1-7a74-b7f3-2fb0f4393e01",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a118ac-1a50-7aba-9bbf-abf721acc718
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/actor.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/identity.ts
---
`identityOf` (`invocation/admission/identity.ts`) reads the grant's non-empty header. If the signature does not verify (`threadOf` returned null) or there is no thread behind the grant (`grantedThread` returned null), the function answers `{ session: null, native: null }` — the same as for a call with no grant. `operationCaller` (`actor.ts`) then assembles `{ kind: 'operator' }`.

Why this is bad. A thread with a stale or damaged grant silently acts as the operator. Its calls bypass the thread's law, approval mode, and attribution. There is no privilege escalation for someone else's local process here: the local door counts the call as the operator's even without a grant. What breaks is the truth about who calls. Turning a failure into a success is what the [[ea465bed|failures]] rule forbids.

Result: only a grant with a valid signature behind which the thread is already deleted refuses (`grant-thread-gone`). A grant signed by another server still leaves the call unsigned: that is by design for a process carrying another Tagma server's grant, e.g. a test one nearby (`nativeSignature.itest.ts`, "a grant this server cannot place leaves the caller unsigned"). The first version of the fix refused in that case too and broke this test; the next commit fixed it.

The original plan: a passed but unverified grant gets a typed refusal at admission (`GateRefusal` with its own code and `unblock`) before the actor assembles. Separate codes for "signature does not verify" and "no thread behind the grant". The bound remote door drops headers on purpose (`admit.ts`); this does not concern it.

Done: the admission test — a call with a bad signature and a call with a deleted thread's grant get a refusal, not an `operator` actor; a call with no grant is still the operator's.

Found by plugins-astra (thread 01a12269-42d2-7541-bf62-a79988c6f9fd) while vetting the spec of plugins, when checking grant as the basis of plugin identity. The code trace is confirmed; the test was not run.
