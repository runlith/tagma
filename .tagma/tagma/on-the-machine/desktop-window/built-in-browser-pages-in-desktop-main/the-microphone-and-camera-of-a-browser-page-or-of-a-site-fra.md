---
id: 01a148a7-a0b7-7e53-9a1e-a1fdde72d807
title: The microphone and camera of a browser page, or of a site framed in Tagma's window, are granted by a person per origin; a frame never shown is denied
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/profiles.ts
  - kind: file
    ref: apps/tagma/desktop/src/mediaGrants.ts
---
Tagma already holds macOS microphone and camera access for dictation, so answering from the system status alone would hand the devices to any site, including one the agent visits itself or one a plugin's view frames inside Tagma's own window. So the person decides first, in the window where the page or frame is shown; one with no shown window — background, under the agent, a hidden or minimized window — is denied without asking. The decision stands per origin until the app exits, and the permission check answers with the same decision. Window visibility is checked on every request and check, not just before asking: otherwise a once-allowed origin would receive the device in a hidden or background page too. Only after “Allow” is the system asked.

One class, `MediaGrants`, is that decision. A browser profile keeps its own decisions under its partition; Tagma's windows keep theirs under one scope. In a window it judges only a subframe's `media` request and check, so Tagma's own page (dictation) is answered as before, and every other permission keeps its answer in a profile and in a window.
