---
id: 01a0c999-12ee-7c6e-a189-54063f28ad30
title: The redact terminator still opens an overrun when the next key's colon sits on the following line, and the class chosen to avoid it protects against a case that cannot occur
ord: 54
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c975-4b79-7dd9-8e7e-6337a5f88bee
---
Found reviewing [[a5f88bee]]'s fix (`16b69bf1cd`), which bounded the redact terminator so a match cannot eat the next key's opening quote.

**The overrun class survives for a colon on the following line.** `packages/llm/src/redact.ts:10` still accepts the pair-opening quote when the next key's colon sits on the line after it, because the class between the name and the colon is `[ \t]*` and cannot cross the newline. Legal JSON whitespace reaches it: `{"token":"abc\`⏎`,"apikey"`⏎`: "sk-live-1"}` — one character class away from the landed test's own shape. The match eats `"apikey"`'s opening quote, after which `apikey"` matches neither name branch and `sk-live-1` stands clear unless it is in the sent-secrets set.

**And the stated rationale for `[ \t]*` is inverted.** The author chose it over `\s*` because `\s*` would cross a newline and falsely reject a legitimate closer in pretty-printed JSON. The reviewer traced both directions and could construct no false reject for `\s*`: a false reject needs the first quote after the candidate to stand directly before a colon with no quote between, and pretty-printed JSON with the value on its own line cannot reach the lookahead at all because `[^"\r\n]*` cannot cross the value's line end. So the catastrophic case the author avoided does not exist, and the change that would avoid it is what closes the live leak.

**The tests are thinner than reported, and one was loosened.** The author reported no-comma and CRLF cases; neither is in the tree (`sk-live` occurs only at two lines). Pretty-printed input, CRLF, and a bare newline inside a value have no exact-output test, so their byte-identity rests on traces. And the rewritten shape test replaced an exact-output assertion that still holds — byte-exactness dropped for no gain.

Fix at the owner: widen the class between the name and the colon to cross a line terminator, add the reported no-comma and CRLF cases plus a pretty-printed pair with the colon on its own line, and restore the exact-output assertion where its input carries no trailing delimiter.