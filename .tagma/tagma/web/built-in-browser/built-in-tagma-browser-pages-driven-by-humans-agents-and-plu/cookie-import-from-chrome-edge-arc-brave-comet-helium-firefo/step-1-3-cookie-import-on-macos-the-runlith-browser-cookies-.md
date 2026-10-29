---
id: 01a147d6-7ef4-7c9c-9e39-feaf6b689562
title: "Step 1.3: cookie import on macOS — the @runlith/browser-cookies kit, Chromium, Firefox, Safari, and Tagma-profile reading, the Keychain key, writing through the profile session"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a11eae10179
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-fea9ce0f09a0
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-feaa461a081e
---
Implement [[eae10179|cookie import]] for macOS: a kit with a model, a policy, and ports, reading and key adapters from the Keychain experiment outcome, the `list_cookie_sources` and `import_cookies` operations, writing through `ProfileHost.session` with rejected-counting and broken-write rollback.

Done when: the spec's performer checks pass on fixtures and against a managed host; `bun run typecheck` is clean; review is done; the commit goes through `submit_work`.
