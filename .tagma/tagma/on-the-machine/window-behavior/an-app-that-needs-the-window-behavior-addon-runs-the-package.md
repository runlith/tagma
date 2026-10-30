---
id: 01a0c700-80c9-7d3f-af8e-e61939a8f922
title: An app that needs the window-behavior addon runs the package's native installer itself
ord: 8
tags: ["rule"]
sources:
  - kind: file
    ref: packages/window-behavior/bin/window-behavior-native-install.mjs
  - kind: file
    ref: packages/window-behavior/package.json
---
Building needs macOS and the Xcode Command Line Tools and writes into the package's native directory. The app calls the package bin `window-behavior-native-install`; when the package is vendored into another repository the duty stays with the app.