---
id: 01a123ff-0fa7-773d-82ac-98cec0741e9f
title: "send_notification is idempotent by sender key: a repeat with the same key returns the previous notification instead of creating a second"
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12343-f844-71b2-8671-d14c87016da1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123d1-efb6-71d1-a97d-0dbe4da01bb2
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
Acceptance of the Linear bridge: if a notification is accepted but the HTTP response lost, the plugin's next tick sends it again and creates a duplicate; marking "sent" before the request is no good either — notifications would be lost. `send_notification` takes only title/body/question, `Notifications.send` always takes `randomUUID`. An optional send key needed: the same (sender, key) returns the previous notification id and creates no line — including across plugin and server process restarts. Done when the owner's notify integration test shows: a repeat with the same key from the same sender returns the same id and one line; the same key from another sender is a separate notification; without a key behaviour unchanged.
