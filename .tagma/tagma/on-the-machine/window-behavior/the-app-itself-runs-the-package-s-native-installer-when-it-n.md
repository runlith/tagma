---
id: 01a0c700-80c9-7d3f-af8e-e61939a8f922
title: The app itself runs the package's native installer when it needs the addon
ord: 8
tags: ["rule"]
sources:
  - kind: file
    ref: packages/window-behavior/bin/window-behavior-native-install.mjs
  - kind: file
    ref: packages/window-behavior/package.json
---
Building needs macOS and Xcode Command Line Tools; it writes into the package's native directory. The app calls the package bin. When vendored into another repository the duty stays with the app.
