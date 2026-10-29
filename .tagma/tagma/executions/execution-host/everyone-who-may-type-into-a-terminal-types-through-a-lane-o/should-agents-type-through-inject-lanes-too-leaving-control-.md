---
id: 01a0cf4b-e134-7345-8f3c-33e0da979b60
title: Should agents type through inject lanes too, leaving control as the holder's right to move custody alone?
ord: 8
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
---
After this decision the operator and the server type through inject lanes, but an agent still types through the control its start installed ([[18e1a478]]). Control then means two things: the right to move custody, and an agent's typing.

If agents typed through lanes too, control would be only the holder's right to move custody, and the generation fence would guard nothing that types. The cost is the start road, which installs control before answering, the managed spawner that presents it ([[41dfaa19]]) and the trust asks around a take ([[37677b13]]). Worth deciding only if the two meanings cause a real defect.
