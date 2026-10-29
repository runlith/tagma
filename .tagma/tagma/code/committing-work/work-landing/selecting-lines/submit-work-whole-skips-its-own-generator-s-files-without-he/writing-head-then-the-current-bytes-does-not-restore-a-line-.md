---
id: 01a12827-2752-77b0-96d9-1ad8500f8ffc
title: Writing HEAD then the current bytes does not restore a line's authorship
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Both write sequences answered “Wrote file successfully”, but read_changes on the path both times left “nobody +1/−1 (written outside the record)”. The HEAD copy is verified with git hash-object: ecad0e1870e1008c56fee22bc3c45102acd89438 matches HEAD:path.",
    "command": "write CheckoutPage.svelte.test.ts with current bytes; then write from scratch with exact HEAD bytes and write the saved current copy; read_changes(path) after both sequences",
    "expected": "The last instrumental write makes the changed line held by this session so submit_work can land it."
  }
---
