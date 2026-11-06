---
id: 01a1b1e2-f86d-75ed-9fcf-146af857794e
title: The fresh world opens under an environment built from nothing and resets what macOS keeps for its bundle outside its home
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/mac-release/fresh.ts
  - kind: file
    ref: apps/tagma/server/src/mac-release/home.ts
---
The fresh world is a new user only as far as its environment and what macOS keeps outside its home are its own; each step of the adapter answers one way macOS would otherwise hand it the developer's state. Measured on macOS 26.0.1.

- **Launch environment.** `open` hands the launched app the caller's whole environment, `TAGMA_*` session variables and Tagma Dev's PATH included. The app is therefore opened under an environment built from nothing — the isolated home and Finder's PATH — and LaunchServices adds only what any app opened from Finder gets.
- **Home.** `HOME` alone moves Tagma's data, junction and harness configs; `CFFIXED_USER_HOME` also moves what Cocoa finds through the home directory (Electron's caches and application paths). Both come from the same isolated home the release cut's trial world uses.
- **Keychain.** Under another home macOS finds no login keychain, so a harness CLI could neither see the developer's sign-in nor save its own; the home gets an empty, unlocked login keychain of its own, created once and unlocked at every open.
- **Preferences.** `cfprefsd` keeps a bundle's preferences in the real `~/Library/Preferences` whatever the home says, so starting over deletes the bundle's domain.
- **Privacy permissions.** TCC answers by bundle id and resolves it through LaunchServices, so they are reset before the world's registrations are forgotten — for the app and only the helpers whose ids extend its own: releases issued before helpers took their channel's ids carry Electron's stock `com.github.Electron.helper`, which Tagma Dev and other Electron apps share, and a reset of that id would revoke their permissions too; LaunchServices keeps a deleted bundle registered, so its registrations under the root are forgotten after the root is removed.

On the developer's Mac the release runs only in the fresh world, so what macOS keeps by its bundle id is the fresh world's to reset.
