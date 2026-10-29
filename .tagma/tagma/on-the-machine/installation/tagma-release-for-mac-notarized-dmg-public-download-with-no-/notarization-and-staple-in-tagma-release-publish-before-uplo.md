---
id: 01a135f8-f7f6-79d3-aba2-5841c9e2039e
title: Notarization and staple in tagma:release publish before upload; quarantined DMG opens without warnings
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12660-dbc3-70fa-b84b-c55e56bcec26",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
---
Step 6 of the spec, "Signature and notarization". Notarization is the first step of `tagma:release publish`, not of the build: `notarytool submit --wait` with the `tagma-notary` profile, refusal prints `notarytool log` and stops publishing before GitHub; `stapler staple` on app and DMG, `spctl --assess`; a notarized build is not resubmitted on repeat. The operator creates the profile in the keychain.

Done: `spctl --assess --type execute` accepts the app, `stapler validate` passes on app and DMG; a quarantined downloaded DMG opens offline without a Gatekeeper dialog.
