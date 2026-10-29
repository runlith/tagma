---
id: 01a0f274-557e-7f33-a787-ec7b199b2d0d
title: CLI-login tests inherit CODEX_HOME and expose real credentials in failing assertions
ord: 53
tags: ["reflection"]
fields:
  {
    "actual": "Inherited CODEX_HOME overrides the test home in codexCliLogin.find. Three tests read the operator's real store and print access and refresh tokens in assertion output. Credential values are omitted from this report; production precedence is unchanged and the fixture isolation is the defect.",
    "command": "bun run test:integration in packages/llm, then isolated reproduction of three cliLogins.itest.ts cases",
    "expected": "Read only the temporary login stores each test creates; diagnostics contain synthetic fixture credentials."
  }
---
Filed from project `runlith`.