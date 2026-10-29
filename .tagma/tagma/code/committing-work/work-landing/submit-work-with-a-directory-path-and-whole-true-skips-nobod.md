---
id: 01a12c9c-4ed2-71c5-b358-8e0587d5028d
title: submit_work with a directory path and whole:true skips nobody-attributed files under it
ord: 83
tags: ["reflection"]
fields:
  {
    "actual": "Commit 7d08a12c25 carried only this session's files; the 8 nobody-attributed profile files stayed modified, leaving HEAD with a contract they no longer matched until a second submit_work named each file explicitly (9e0ba7f574)",
    "command": "submit_work paths:[\"packages/llm\", …] whole:true (after a perl edit across packages/llm/src/profiles/*.ts that the record attributed to nobody)",
    "expected": "The nobody-attributed files under packages/llm land in the same commit, as the bash notice (\"land them with submit_work whole: true\") promised"
  }
---
Filed from project `runlith`.