---
id: 01a0d871-2957-7cb8-bbd8-294e2b4bf576
title: Where a project program's own code is read from, so a landing cannot loosen its gate by an unlanded edit of the program
ord: 15
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
A program rule with no `needs` runs in the checkout root ([[50467aad]] §4), so a relative argv such as `tools/check.js`, and everything it imports, is read from the working tree there, unlanded edits included ([[3c941e79]]). A session can loosen its own gate by editing the program without committing it, and a live peer's unfinished edit of the program runs under another session's identity at that session's landing. With `needs: 'files'` the program runs in the judged tree instead, so its own changes land visibly with it.

**Options:**
- **Run every program in a clone of the base.** It costs one materialization per judgement: reading runlith's 28,258-file tree took 5.5–16.9 s under load averages of 28–47.
- **Pin a content digest of the program's files in the enforcement document.** The program would have to declare its files, and a change to them would become the `rule-program` subject.
- **Require `needs: 'files'`.** It is simple, but a landing's own change to the program still judges that landing.

**What would inform the choice:** how often program rules stand at landing rather than at merge, and whether runlith's layer runner can run from a clone without `bun install`.