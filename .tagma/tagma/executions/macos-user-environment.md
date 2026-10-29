---
id: 01a13c2d-91c4-7431-95d1-f9f9d3af780e
title: macOS user environment
ord: 47
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "mac-user-environment",
    "order": [
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
sources:
  - kind: dir
    ref: apps/tagma/server/src/mac-user-environment
---
An application opened from the Dock gets only the system PATH from macOS, while the person installs agent CLIs where Homebrew, nvm, and vendor installers put them. The module knows these places on macOS and reads PATH from the login shell profile, filling the installation module's user-environment contract; when to read the profile and how to assemble the process PATH from its parts is decided by installation.
