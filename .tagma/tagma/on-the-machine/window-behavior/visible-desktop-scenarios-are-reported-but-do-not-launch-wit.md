---
id: 01a183e6-8165-7760-b5f0-42da521d6f1a
title: Visible desktop scenarios are reported but do not launch without a headed run
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/window-behavior/e2e/examples.fixture.ts
  - kind: file
    ref: packages/window-behavior/e2e/macos-native-smoke.e2e.ts
  - kind: file
    ref: packages/window-behavior/package.json
---
Both window-behavior suites manipulate real visible windows, so they declare headed scenarios and their manual package commands select them explicitly with --headed. The desktop command stands outside the headless CI e2e script because its window-manager effects need an interactive desktop. The native smoke also takes over Finder and requires the native addon plus existing Accessibility and Automation grants; its dedicated command builds the addon first.