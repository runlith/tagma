---
id: 01a148a7-a0b7-7e53-9a1e-a1fdde72d807
title: The embedded browser page's microphone and camera are granted by a person per origin; a page never shown is denied
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/profiles.ts
---
Tagma already holds macOS microphone access for dictation, so answering from the system status alone would hand the microphone to any site, including one the agent visits itself. So the person decides first, in the window where the page is shown; a page with no window — background, under the agent — is denied without asking. The decision stands per profile and origin until the app exits, and the permission check answers with the same decision. Window visibility is checked on every request and check, not just before asking: otherwise a once-allowed origin would receive the device in a hidden or background page too. Only after “Allow” is the system asked.
