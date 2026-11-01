---
id: 01a19905-2c86-71ac-85ac-c627a6f7eade
title: Cloudflare dashboard sign-in fails in Tagma's built-in browser, while Chrome signs in
ord: 53
tags: ["reflection"]
fields:
  {
    "actual": "The operator reports Cloudflare blocks the built-in (Electron) browser at once; he signed in through his Chrome driven by chrome-devtools instead.",
    "command": "open_page https://dash.cloudflare.com/<account>/r2/overview in profile \"user\" (and \"agent\"), then sign in to Cloudflare",
    "expected": "The built-in browser signs in to the Cloudflare dashboard as the operator's Chrome does, so an agent can do console steps beside the thread."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T20:57:10.402Z, from e01bcf4b6.

What the agent itself saw before the operator's attempt (2026-11-01, ~21:26 UTC): both profiles loaded the login page with the Turnstile frame reading "Success!"; neither profile held a Cloudflare or Google session; "Continue with Google" in profile `user` reached Google's identifier page. The block the operator met happened during his own sign-in and was not observed by the agent, so which step Cloudflare refuses (Turnstile, the login POST, or the Google OAuth return) is not established.

Earlier, on 2026-10-28, the opposite was recorded for Chrome: dashboard writes answered a WAF 403 while chrome-devtools was attached with `--autoConnect` (runlith note ef68cb54). Today the operator's Chrome with chrome-devtools signed in.