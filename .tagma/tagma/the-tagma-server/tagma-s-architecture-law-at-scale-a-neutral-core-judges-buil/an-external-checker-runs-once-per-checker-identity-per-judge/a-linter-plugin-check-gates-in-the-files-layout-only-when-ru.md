---
id: 01a0f743-cbe6-786f-8aed-01f0c09fe8dc
title: A linter-plugin check gates in the files layout only when runners.json declares it path-equivalent and adoption proves identical readings in scratch and at checkout paths
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## 1. Outcome
A rule of a linter plugin the project ships (an oxlint JS plugin) can be adopted and gate without a Tagma release, in the files layout, once its check is declared path-equivalent and that declaration is proven against the accepted commit.

## 2. Problem
The files layout runs one process over a scratch copy: cwd and file names differ from the checkout. A plugin that derives behaviour from cwd or the path prefix (`checks/lint/catalogTags.ts#readLiterals`) answers clean in scratch. Commit 8adbb7812c therefore refuses every JS-plugin check, which makes be843c7e's last acceptance item unreachable.

## 3. What holds now
`runners/oxlint/config.ts#filesConfig` admits only native oxlint plugins without `import` rules; a governed JS-plugin check fails inspection before any process starts.

## 4. Target
- A check in `runners.json` may carry `layout: { equivalent: "files" }`. Without it a JS-plugin check keeps refusing.
- The adoption act that records the checker locator proves the declaration once per checker identity: it runs the check over the accepted commit twice — in the scratch files layout and in a clone holding the tree at its own relative paths with cwd at its root — and compares fingerprints and counts. Any difference refuses adoption with both readings named. Native checks keep the adapter's own conformance proof.
- The proof is part of the adopted identity: a new checker digest needs a new proof.

## 5. Owners
The oxlint adapter (`apps/tagma/inspection/src/runners/oxlint/**`, `enforcement/programs/oxlint.ts`) owns the declaration schema and the proof routine; the N+1 adoption writer (task ab196d8d) calls it when it records a runner locator.

## 6. Rejected
- Two processes per judgement (checkout-path layout for both sides): doubles the cost every landing pays to protect a property provable once at adoption.
- Trusting the declaration without a proof: a wrong declaration turns a gate into a silent pass.
- Dropping plugins from the files layout: leaves the outcome of [[d11108eb]] — a project's own linter rule without a release — unmet for plugins.

## 7. Acceptance
- A fixture plugin that reads only file content is declared, proven and gates a landing.
- A fixture plugin that reads cwd is declared and its adoption refuses with both readings.
- An undeclared JS-plugin check keeps refusing.

## 8. Blocks touched
Claims [[941c52e5]] and [[00ecfaba]] are revised by the adapter's author when built; task be843c7e finishes against §7 here.

## 9. Order
Adapter: declaration and proof routine first; then the adoption writer calls it.

- out 10–17: the declaration is an optional field of an existing descriptor (absent keeps today's refusal); nothing is stored beyond the adopted digest; no long-lived state; the proof costs two readings of the accepted commit once per identity, bounded by the existing envelope; rollout is per rule at adoption; a failed proof refuses adoption and changes no running gate.
