---
id: 01a1860d-cd09-7d59-b00e-b103b73f97b6
title: strip_comments names an exemption marker no description or skill spells out
ord: 148
tags: ["reflection"]
fields:
  {
    "actual": "exempt: none for every candidate; the tool says 'a file whose first comment marks it exempt stands whole' but neither its description, the writing.comments setting nor any skill names the marker",
    "command": "strip_comments path=harness/probe (files opening with // @generated, /* eslint-disable */, // tagma-exempt, /* @license MIT */, and one marked linguist-generated in .gitattributes)",
    "expected": "One documented way to keep a file whole under writing.comments=forbid — needed for third-party test data copied verbatim into a repository"
  }
---
Filed from project `dromon`.

Dromon copies 1098 upstream Svelte runtime samples into harness/samples as data that must stay byte-equal to upstream (plus an import rewrite map). A probe through strip_comments showed the landing door would drop their comments, including `/* vite-ignore */` inside `import()` and template `<!-- -->` comments that `preserveComments` samples render. JSDoc type casts and eslint pragmas were kept. Without a spelled-out exemption, the only options are changing the project's comment law or landing altered upstream data.