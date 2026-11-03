---
id: 01a1a297-fcf1-7cba-990f-81898883474c
title: Claude Code and Codex logins are observed without a selection, and the composer default waits for them
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a298-9069-764d-82a9-ff141f1e5bc5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1a269-e94d-72aa-a381-ba8c0f512781
---
Server, adapter and test half of [[0f512781]]: everything except the app.

Wire contract the app half builds against. Change it only by agreement with the app task's holder:
- `begin_sign_in` answers a new arm `{ flow: 'adopted', provider, account, label }` when Sign in finds the default login already signed in. A project is needed only for a terminal flow.
- The account problem union gains `{ kind: 'unsupported-method', method }` next to `signed-out`, `unreadable` and `not-installed`.
- `read_model_defaults` keeps its shape and waits on discovery readiness before answering `unconnected`.
- Birth on a signed-out account refuses `account-signed-out`, naming provider and account.
- `observe_logins` is a new operator-only operation with no input, called by the app on window focus. It re-locates declaring CLIs not known signed in, runs one status read each, and publishes through `accounts.subscribe`.
- The first send without a saved model saves the model it was born on as the default.
- `AccountQuotaRow` (the CLI's own row) carries `lent: [{ provider, problem }]`, one entry per provider borrowing that login, `problem` null when the borrower can use it. The CLI's own `problem` decides signed and "Add account"; the card's native usability and reason read `lent` for the plan's provider. A change in `lent` publishes a frame.
