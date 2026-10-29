---
id: 01a0c853-541e-701f-81f1-d2bf06826a4e
title: "Run 4: StepFun Step 5 Preview and Step 3.7 Flash, full brief, graph closed"
ord: 8
---
Two StepFun models wrote the same zone draft the earlier runs used — `apps/tagma/server/src/worktrees`, 9 files, 1803 lines — under the full brief (comments lie, the cost of a claim, totality discipline, format, anchors confirmed, no target count), with one change: **the graph was closed to them entirely**, no read and no write, so the vocabulary rode in the brief and the reference zone [[adeeb4ba]] was not available. Everything else matched run 3 ([[7df9bc43]]). Both wrote into their own scratch; nothing was applied.

The region carries two known traps, which is why it is the bench: `CheckoutReads.containing` resolves the caller's path through `realPath` and compares `row.path` as recorded, under a comment saying "Canonical on BOTH sides"; and `CHECKOUT_PLACE_REFUSALS`, under a comment saying it is "the whole of them", omits `destination-reserved` and `coverage-environment`, which the shared mapper can answer — so that road throws instead of refusing.

## Step 5 Preview (high) — 29 minutes, 62k output tokens

1 module, 4 areas, 25 claims, 2 rules; 50 symbol anchors all confirmed `defined` through the server's own reader before finishing; `jq` parses, every body file exists.

**Both traps caught and written as claims bound to the deciding line**, not as prose beside them: the canonicalization asymmetry states the consequence a reader acts on — a covered root whose recorded spelling is not canonical is matched by no path at all — and the refusal hole names the two missing words and what they mean. A third contradiction it found unprompted: `ProjectStores.list`'s comment says the acts refuse a withheld store by name, while the gate answers `true` for it and the refusal actually comes from the registry read inside the act; it wrote no claim on that, because no claim needed one.

Its `NOTES.md` separates what it read whole from what it read at the surface, lists six claims it considered and dropped with the reason for each, and — the part no earlier model produced — states four open questions as questions, including whether the refusal hole is live or latent (it says that depends on whether those two reasons can arise on this road, which it did not establish) and that the comment's "N × 60 ms" figure behind a bound of four is unverified, so the claim does not carry it.

Weak spots: titles run long — several are two clauses where one would do ("Containment is decided on the canonical spelling of both the place and every covered checkout, so a path that walks out of a covered root reaches nothing and one named through a symlinked prefix is inside it"), which is the opposite failure from Muse's terseness; and four areas drawn one per source file is a directory cut wearing area names, which the brief warns against — though here the four files genuinely are four concerns, so it lands right by luck as much as by judgement.

## Step 3.7 Flash (high) — 5 minutes, 14.5k output tokens

4 areas, 13 claims, 3 rules; format correct, anchors said to resolve, three comment/code contradictions named in `NOTES.md`.

**One claim is false, and it is the trap one**: "The worktree refusal vocabulary is exhaustive and stable across surfaces", whose own body describes the runtime throw that the omission causes. Measured at the lines: `worktreeRefusal.ts:69` maps `RootInconclusive` to `destination-reserved | root-inconclusive`, and `CheckoutReads.ts:33-49` lists `root-inconclusive` and not `destination-reserved`. The model read the mechanism and drew the opposite conclusion from it — the most expensive failure on this scale, because a reader who trusts the sentence is worse off than one who read nothing.

The canonicalization trap it neither caught nor misstated: its `placeOf` claim describes `realPath` on the caller's side and the longest match, promising nothing about the other side. A miss, not a lie.

Its bodies lean on narration — "`prepare` writes only the pending record; `execute` re-reads the store, destination and base at the moment of the act and only then takes the reservation and runs git" — which is the source read back and the first thing to rot.

## Where this puts them

Against the run-3 order (Opus xhigh > Muse max > Sonnet xhigh > DeepSeek max > SWE-2), **Step 5 belongs with the top two**: it is the only model besides Opus to catch both traps in one pass, and the only one of any run to state its open questions as questions rather than resolving them by assertion. It pays for that with 29 minutes — three times Muse's run and six times Step 3.7's — and with titles that need cutting.

**Step 3.7 Flash sits below SWE-2**: fast and correctly formatted, but it wrote a falsehood exactly where the region was built to catch one, and its bodies retell the code. It is usable where a draft is reviewed by something else, not where a draft is trusted.

The graph being closed changed less than expected. Neither model asked for it, neither's notes complain about it, and Step 5's cut is as well-drawn as run-3 drafts that read [[adeeb4ba]] first. What the reference zone buys is calibration of density, not of correctness — and density is exactly where Step 5 is weakest.
