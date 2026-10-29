---
id: 01a18326-d7a0-758a-b04c-d8907078b874
title: The browser address field stays in place on focus and lists at most six suggestions under itself, only for typed text
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a182b5-9dde-787d-b6bb-6d124d3d6df0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a182f1-2b3a-7943-9144-1ee66a367f81
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0462886d0b63
---
The card that covered the whole toolbar row on focus and listed every served address and every open page with an empty query (about 35 rows down to the window's bottom in the operator's project) is replaced by the operator-approved second mockup: a click or ⌘L edits the field in place at the same size with the address selected; nothing is listed until a letter is typed; then a list of at most six rows hangs under the field at its width, without group headings — row zero is what Enter does, a search for the typed text closes the list when row zero goes to an address, matches rank by host start, then a word start in the title, then anywhere. Back, forward and reload stand on a blank page too, disabled, so the field does not move on the first load; the blank page body keeps only the profile choice.