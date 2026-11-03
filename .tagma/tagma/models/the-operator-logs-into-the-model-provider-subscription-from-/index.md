---
id: 01a14c08-22b6-75de-88f8-5beef443c147
title: The operator logs into the model provider subscription from the window — by browser, device code, or pasted code
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf2a65d1a0a
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bff8fe67900
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5c0082a1e659
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/Group.svelte
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/signIns.ts
  - kind: file
    ref: packages/adapter-cursor/src/accounts.ts
  - kind: file
    ref: packages/llm/src/oauth/callback-server.ts
  - kind: file
    ref: packages/llm/src/oauth/flows/deviceGrant.ts
  - kind: file
    ref: packages/llm/src/oauth/ProviderSignIn.ts
---
**Value.** A ChatGPT subscription becomes a Tagma account without hand-copying tokens; Cursor signs in through the browser, which issues a user API key, or with an existing key.

**How.** Settings → Providers, the provider section: "Sign in" or "Add account"; the `begin_sign_in` and `complete_sign_in` operations; from the terminal — [[82a1e659|tagma auth]].

**Behaviour.** The provider adapter declares the login paths: browser with return to a local port (ChatGPT), device code, pasting a code from the vendor page. Cursor uses the official Cursor.auth.login with the system browser and store:null: the issued key is kept by Tagma, and deleting the account does not revoke the key at the vendor. If there are several paths, the button opens a menu. While the operator confirms at the vendor, the window itself asks the server whether the login finished; nothing needs closing or returning. The provider's first account becomes the default account, and its quota is read at once. "Sign in" on a logged-out line starts a new login of the same provider. A provider counts as connected, and offers "Add account", only through a signed-in account; a found but signed-out login counts as neither. Sign in on a CLI provider whose default login is already signed in adopts that login at once, with no terminal.

**Limits.** A provider's new login cancels its unfinished login. All login operations are the operator's: the agent does not start a login. Claude Code and Codex log in via their CLI ([[6fa09803]]).
