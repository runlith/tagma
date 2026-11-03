---
id: 01a1a297-fcf1-7cba-990f-818a896d5c8e
title: "The new-thread composer shows the found login: pending slot, adopted sign-in, signed-out notice"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a298-6035-7b3a-ba83-8eec8fc3c34b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1a269-e94d-72aa-a381-ba8c0f512781
  - kind: relates
    to: 01a1a297-fcf1-7cba-990f-81898883474c
---
App half of [[0f512781]]:
- the pending model slot while defaults are unknown;
- the `adopted` sign-in outcome in `SignInFlow`, `ConnectCard` and `Group`, with "connected" and "Add account" decided by signed rows;
- the composer's signed-out notice with "Sign in again" and "Choose another account", stopping the send before launch;
- the card and row words;
- calling `observe_logins` on window focus;
- the new-thread e2e (acceptance 8).

It builds against the wire contract in the server task [[8883474c]].
