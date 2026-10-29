---
id: 01a17025-2c24-77f0-872e-5fad31cd14cf
title: "An agent never runs programs that trigger macOS system dialogs: shell Chromium only with `--use-mock-keychain` and its own `--user-data-dir` in a temp directory"
ord: 10
tags: ["rule"]
---
A keychain, permission or install dialog pops over the person's work and waits for their answer. Whatever can be checked through Tagma's managed browser or an itest is checked there: they already run Chromium with no keychain access.
