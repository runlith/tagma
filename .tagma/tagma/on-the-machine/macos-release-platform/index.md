---
id: 01a1a95d-e159-7393-b1ce-ac0137f92c13
title: macOS release platform
ord: 42
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "mac-release"
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports
    to: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
  - kind: imports
    to: 01a1165d-b047-7099-969a-602c520698f4
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a132c7-c70e-71c2-9a65-20a479a88a92
  - kind: imports
    to: 01a13b1a-1851-79b3-ba84-3b0e9f581885
  - kind: imports
    to: 01a1a316-f62a-7363-b503-d860360417ba
  - kind: imports
    to: 01a1b1dd-55ac-79cc-8b70-e2d9a9017344
  - kind: imports-tests
    to: 01a127e3-cc5c-73fa-99ff-b228d2a60527
sources:
  - kind: dir
    ref: apps/tagma/server/src/mac-release
---
Tagma is released for macOS, and this module is the release toolchain's platform there: it fills the cut's release platform with the Apple steps — the darwin targets and their Rust and Rosetta checks, the official Bun build for each, the local and Developer ID signing identities in the login keychain, sealing native code with codesign, the BSD tar archive, the disk image, notarization with Apple, and the trial world that installs a cut's Tagma.app the way a person does. It also owns `tagma:transition`, which checks the move from the issued release to the tree through the macOS application. What a release carries, how it is staged, proven and published stays with the release toolchain.