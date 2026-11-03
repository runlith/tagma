---
id: 01a132c7-c70e-71c2-9a65-20a479a88a92
title: Mac application
ord: 40
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "mac-applications",
    "order": [
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
sources:
  - kind: dir
    ref: apps/tagma/server/src/mac-applications
---
The release keeps a copy of its own `Tagma.app` beside it, and the person keeps their application wherever they want: the module checks the signature of the application the release carries, copies it into `install/<v>/desktop`, clears quarantine from copies only after checking, replaces the bundle in place for the window, compares the downloaded application's signature against the installed release's application, removes the old layout's place records, and unregisters from LaunchServices every `.app` of the release directory the prune deletes: otherwise every once-run copy and its helpers stay in the LaunchServices database as dead records. It also removes an issued window's leftover outgoing bundle beside the application proven by that window's declared main process and the kernel's matching birth and executable; a renderer or reused pid authorizes no cleanup. A transient reader or filesystem refusal remains pending while the main declaration lives: retries need no new desktop event, and recovered or departed windows are not probed again. It owns the bundle layout — the application's name, its executable and the release it carries inside — whose values issued windows and servers read, and fills the installation module's applications port with where a release keeps its application and where that application carries the release; which releases are installed and which is current is decided by installation, and the person's application location is decided by the window.
