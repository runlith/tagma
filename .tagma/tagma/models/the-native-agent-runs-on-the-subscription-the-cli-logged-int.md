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
**Value.** Tagma's native agent runs on the ChatGPT subscription the CLI already logged into, without a second login and without logging the CLI out.

**How.** CLI-login mode in the vendor section ([[948797f4]]): Tagma's own path takes the accounts of its vendor's CLI provider.

**Behaviour.** The model-call request itself confirms the choice of the CLI provider lending its credentials: the existing default login is found with no prior directory, CLI thread, or re-login. Passive lists and quota do not open an untouched CLI. Each request rereads the token from the CLI account directory. An expiring token is refreshed by the CLI itself: Tagma starts it in the account environment with no model call, parallel requests wait on one such start, and if someone else already refreshed the token, the CLI does not start. Codex refreshes the login only on refusal, so a 401 on its login starts a refresh and one retry. The default account and quota of such an account are shared with the CLI provider; the line stands in the CLI section.

**Limits.** Tagma never refreshes a borrowed token itself: its refresh would log the CLI out. Such an account can only be deleted or renamed in the CLI section.
