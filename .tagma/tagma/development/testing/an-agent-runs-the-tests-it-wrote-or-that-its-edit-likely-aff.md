---
id: 01a17e7d-fbfe-7b1b-ab23-963e038c06ff
title: An agent runs the tests it wrote or that its edit likely affected; a full run goes only on request or in CI
ord: 16
tags: ["rule"]
---
A full run is `test:all`, `check:change`, a whole package `test` or `test:integration`. A wide run takes all the machine's cores for minutes and slows other agents and the person's work, so inside a task it is never started unasked and a green run is never repeated. Whatever is left unverified is named when handing the work over.
