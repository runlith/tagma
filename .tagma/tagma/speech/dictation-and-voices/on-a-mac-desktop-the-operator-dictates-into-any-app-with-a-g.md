---
id: 01a14c08-619e-7ae1-af8b-16c18fcdc916
title: "On a Mac desktop the operator dictates into any app with a global key: the pill shows text, release pastes it"
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-619e-7ae1-af8b-16c009901e65
sources:
  - kind: dir
    ref: packages/desktop-input
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Global.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/Pill.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/dictation/pill.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/routes/_desktop/dictation/+page.svelte
  - kind: file
    ref: apps/tagma/desktop/src/Dictation.ts
---
**Value.** The operator dictates into any Mac app — mail, editor, messenger — with the same Tagma speech, without switching to the Tagma window.

**How.** Desktop app only on macOS: enabled in Settings → Speech → Voice input (`speech.dictation.global`, off by default), the key is `speech.dictation.globalKey`. Holding shows a pill at the screen bottom with level and live text; releasing pastes the text where the cursor stands.

**Behaviour.**
- Needs Accessibility permission for Tagma. Without it the setting shows the reason and a system-request button; permission revoked mid-dictation cuts it off.
- While the Tagma window has focus, its own dictation key works and the global one is not intercepted. Outside the window the chord is swallowed so the app receives no spaces.
- Pasting goes via ⌘V with clipboard swap and restore. If it failed or the input helper is lost, the text stays in the clipboard, and the pill says to press ⌘V.
- `Esc` during the pill cancels dictation; the active app also receives it.
- A lost input helper restarts itself no more than once a minute; otherwise the setting shows the reason.

**Limits.** macOS and desktop only; a browser window does not show this setting. The key must be a letter, digit, function key, or space. Off by default, so as not to fight over the key with other dictation programs.
