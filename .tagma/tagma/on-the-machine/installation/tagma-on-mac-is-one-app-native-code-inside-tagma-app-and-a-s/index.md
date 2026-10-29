---
id: 01a1047e-ddf0-7edd-b8da-e66dc7d48051
title: "\"Tagma on Mac is one app: native code inside Tagma.app and a stable signature\""
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ff30-3ce0-7879-8c00-c376b4ee7196
  - kind: relates
    to: 01a1047e-ddf0-7edd-b8da-e66cc3dad364
---
Tagma on Mac is an app. Native code (audio capture and everything needing macOS permissions) lives inside it, and all of it is signed with one identity that never changes between builds. Then macOS asks permission once on behalf of "Tagma", and rebuilds and restarts never reset it. The grounds are the experiments in [[c3dad364|the TCC study]].

## What the user gets

- **The Mac app is the product's main face.** The release is a signed `Tagma.app` from a DMG that installs itself on first launch ([[e7b7be7f]]); it raises the server when it is down and shows the interface.
- **The browser is that server's second screen.** It can do just as much, because the server does the native part, not the window.
- The `tagma` **CLI** is that server's client.
- **Installing the CLI alone with no app** (Linux, CI) works the same, but with no native audio.
- **The development channel** — rebuilding from checkout with restart — is for Tagma developers, not for the ordinary user.

## The rules everything stands on

1. **One identity for macOS — `Tagma.app`.** TCC attributes to the app everything inside its bundle: executables, nested helper apps from `Contents/Helpers`, and processes launched out of them when opened through LaunchServices. Native code that needs permissions lives only there. The server never requests permissions itself: its process may be launched by anyone, and then the permission goes to whoever launched it.
2. **The signature is stable.** `Tagma.app` and everything inside are signed with the same identity on every build. For the developer that is the machine's local self-signed certificate, in the release — the Developer ID. Ad-hoc signing is never used: with it macOS re-asks permission after every build.
3. **The server's life has one owner.** The server is raised by the first client that needs it: the window, the CLI, or `tagma web`. The server restarts itself by handing the place to its successor. It is stopped by "Quit" when nothing runs, or by "Stop Tagma" in the window ([[1c89545b]]). launchd never manages it: why is written in [[2e073431|the launchd idea]].
4. **A signed bundle never changes after signing.** Whatever the checkout build rebuilds often lies outside the signed app. In the release the app is replaced by the next release's app.

## Stages

- [[0c6f5fab|Stable signing]] — now. Audio stands on it: the permission given to `Tagma.app` survives builds. Works with no Apple subscription.
- [[e7b7be7f|The user release]] — Developer ID, notarization, DMG, updating with releases beside and through `succession`.

Audio capture in the audio infrastructure ([[b4ee7196|the audio spec]]) moves onto rule 1: the server drives capture, and a helper inside `Tagma.app` records. That spec will be rewritten by its own work.

## Out of scope

- **The Mac App Store and its sandbox.** Tagma runs commands, git and other people's CLIs, and that is impossible in the App Store sandbox.
- **Signing and installers for Windows and Linux.**
