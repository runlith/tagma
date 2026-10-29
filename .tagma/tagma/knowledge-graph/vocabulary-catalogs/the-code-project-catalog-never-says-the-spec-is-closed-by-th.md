---
id: 01a1417c-4771-7e82-b09a-2c4cefb26971
title: "The code-project catalog never says the spec is closed by the agent that finished the work: 'accepted' reads as 'accepted by the operator'"
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The agent left spec 132e596c open and wrote the operator that it awaits your acceptance; the operator had to sort it out separately and demand closure.",
    "command": "finish_block 8e2e2049 (last task of spec 132e596c), then a report to the operator.",
    "expected": "The agent that finished the spec work closes it with close_block in the same work."
  }
---
Filed from project `runlith`.

Source — apps/tagma/server/src/catalogs/contract/wire/codeProject.ts. Line 57 (#spec) and catalog guidance line 190: "closed by an explicit act when what it describes is no longer wanted or has been accepted; the end of its last task does not decide that". In the same catalog "accepted" means "accepted as a target before building": line 169 "Specs already open under the scope — accepted and unbuilt", line 110 "An accepted target belongs in #spec". So for any open spec the "accepted" close condition is already met, and the text either means nothing or reads as "accepted by someone after building" — by the operator. The "built as described" condition is missing entirely. The "the end of its last task does not decide that" reservation additionally pushes away from closing the spec once the work is done. The close_block description repeats the same formula ("a spec accepted or no longer wanted").
