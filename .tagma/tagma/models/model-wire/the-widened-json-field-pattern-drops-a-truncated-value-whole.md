---
id: 01a0c961-c2f1-7658-9192-5653aac3d0a8
title: The widened JSON field pattern drops a truncated value whole, and its word boundary is pinned by no test
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c8cb-0489-75c1-9523-3097105e821a
---
Found reviewing [[105e821a]]'s fix (`62e7ed68a9`), which widened `REDACT_JSON_FIELD` in `packages/llm/src/redact.ts`.

1. **A truncated value is now missed whole.** The value token is `"(?:[^"\\]|\\.)*"`, which requires a terminated string, so `{"token":"a\"}` — a value whose closing quote is escaped or absent, which truncated failure text produces — matches nothing at all. The removed `"[^"]*"` redacted at least the head of it. The literal pass cannot recover it: `secretsOf` registers the raw and the URI-encoded value and never its JSON-escaped form, so a quote-bearing value in escaped shape is missed by both passes.
2. **The word boundary is pinned by no test.** `\b(?:NAME)` is what keeps `xtoken:` and `sometoken` from matching; nothing asserts it, so dropping `\b` would silently over-redact every identifier containing a sensitive stem with no test failing.

Fix at the owner (`redact.ts` and its test): a value that does not terminate is redacted as far as it stands, and the boundary discipline is asserted — `{"sometoken":"x"}` and `xtoken:"x"` stay untouched while `{"token":"x"}` and `my-token:"x"` redact.

Provenance: reviewer findings 1 and 6 over `62e7ed68a9`, both confirmed non-blocking there and recorded here rather than folded into a change that was already green.