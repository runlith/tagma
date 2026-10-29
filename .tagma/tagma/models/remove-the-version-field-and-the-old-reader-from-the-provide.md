---
id: 01a14c37-8e09-7ee0-93cb-9282644ee398
title: Remove the version field and the old reader from the provider credentials
ord: 20
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/consoleKeyFile.ts
  - kind: file
    ref: packages/llm/src/oauth/credentialDocument.ts
---
Violations of rule acb620dd: `console-keys.json` writes `version: 1`; `credentialDocument.ts` understands the old wrapper with `version` next to the new writer. Migrate the stored once by the owner's step and delete the old form in the same change.
