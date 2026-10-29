---
id: 01a1047e-ddf0-7edd-b8da-e6703de8a8fa
title: "\"The Mac user release: Developer ID, notarization, DMG and Homebrew cask, whole-app update\""
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The user downloads Tagma from the site or runs `brew install --cask tagma`, opens it with no Gatekeeper warnings, and then Tagma updates itself without losing granted permissions. This stage awaits the Apple Developer Program subscription (99 USD a year) and stands on [[e7b7be7f|the loader-based release]]: the same release channel, the same `~/.tagma/install` layout, updates through `succession` and window restart. Wherever this text says otherwise — "everything inside `Tagma.app`", Squirrel or Sparkle — [[e7b7be7f]] rules, and this stage's work will rewrite the section.

## Signing and notarization

- **Developer ID signing.** Every executable is signed inside out with hardened runtime and its own entitlements. Bun gets its own: without `com.apple.security.cs.allow-jit` under hardened runtime its JIT silently switches off, and code runs about 55 times slower ([[c3dad364|the TCC study]]).
- **Notarization and stapling** — for the app and the DMG.
- **The account type** — individual or organization — is the operator's choice at purchase. The Team ID is part of the signing requirement, so a later account change resets every user's permissions once.

## Contents and channels

- **Everything inside the app.** Bun, the server, the interface and helpers lie inside `Tagma.app` (`Contents/Resources/tagma`, `Contents/Helpers`), and the app raises the server out of that installation.
- **Delivery channels** are DMG and Homebrew cask. The official `homebrew/cask` disables casks that fail Gatekeeper starting 1 September 2026.
- **Updates** replace the whole app from a signed feed (Squirrel.Mac from Electron, or Sparkle), then restart the server. Permissions survive because the signing requirement — Team ID and bundle id — never changes.
- The app puts the `tagma` **CLI** into `PATH` on the user's action.
- **The development channel** from checkout stays alongside, with its own `Tagma Dev.app` and its own permissions.

## What proves it

- A downloaded DMG — quarantined, offline at first launch (the ticket is stapled to the app) — opens with no Gatekeeper warning.
- Updating to the next version keeps the microphone and system audio permissions.
- Smoke on macOS 14.2+, 15 and 26 with installation into `/Applications`.
