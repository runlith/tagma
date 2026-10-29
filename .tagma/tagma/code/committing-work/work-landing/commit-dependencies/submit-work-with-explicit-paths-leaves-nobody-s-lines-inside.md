---
id: 01a17119-6885-716a-b484-3c4c0fb48a65
title: submit_work with explicit paths leaves nobody's lines inside a file that has the session's lines, and lands a commit that does not compile
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "Commit c1db55c43c carried operations.ts without the return line and the CHANGE_WAIT_MS import, and did not carry capabilities.ts at all; the answer named capabilities.ts only as “lines of this session still stand uncommitted”. HEAD failed typecheck for two commits in a row until dae0a15ec2 and 4a69d61271 re-landed the files with whole",
    "command": "submit_work {subject, paths: [operations.ts, operations.test.ts, capabilities.ts, mcpServe.ts, door.ts, silence.ts]} after perl -pi renamed a constant in three of these files past the change record",
    "expected": "Explicit paths select changed lines nobody holds, and the commit carries the file as it stands in the working tree; or a refusal naming the nobody lines in the selected path"
  }
---
read_changes showed for each file: “this session +1/−0 writing · nobody +2/−1 (written outside the record)”. The operation's description promises that explicit paths select changes nobody holds, but inside a file where the session has its own lines the nobody lines stayed in the working tree. With no refusal in the answer it is impossible to tell that the commit differs from the checked working tree: typecheck and tests passed on working files, not on the commit's tree.
