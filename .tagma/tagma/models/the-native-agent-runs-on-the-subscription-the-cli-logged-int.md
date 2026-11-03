---
id: 01a14c08-22b6-75de-88f8-5bf142804f17
title: "The native agent runs on the subscription the CLI logged into: the token is read from the CLI, and the CLI itself refreshes it"
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bff8fe67900
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/borrowed.ts
  - kind: file
    ref: packages/adapter-openai/src/oauth/cli/codex.ts
---
**Value.** Tagma's native agent uses an existing file-held ChatGPT subscription without a second login or a Tagma-owned refresh.

**How.** The CLI-login mode in the vendor section takes accounts from the vendor's CLI provider. Declared discovery finds that login before a model is chosen; mode choices and Tagma-owned accounts remain authoritative.

**Behaviour.** Each request rereads the credential from the account's exact directory. An expiring readable credential is renewed by its CLI; parallel requests share that launch, and a reread skips it when another client already refreshed the file. A rejection first rereads the file; an unchanged Codex token asks for sign-in again instead of forcing file storage. The account and quota remain shared with the creditor's section. Discovery readiness holds the first model-default read and birth, and the first accepted send keeps its model as the operator default. Sign-out changes no saved choice.

**Limits.** A keyring-only Codex login is usable for CLI threads but not for native ChatGPT: Tagma does not read the keyring or export a grant. Codex status exposes no effective account identity without side effects, so a readable stale auth.json surviving failed keyring cleanup can name another account from the CLI's effective login. A borrowed record is renamed or removed in the creditor's section.
