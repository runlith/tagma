---
id: 01a14c21-bed3-7a34-adfc-085a742a2743
title: effect-style counts a data-class in Context.Reference as a service implementation
ord: 50
tags: ["reflection"]
fields:
  {
    "actual": "Got service-instance for Layer.succeed(CurrentInvocation, at), although CurrentInvocation is declared Context.Reference<Invocation>; a minimal in-memory reproduction returned violations:[src/data.ts layer service-instance 1607a812], unjudged:[].",
    "command": "bun -e 'checkOf(\"effect-style\", {base:\"\",region:[\"src/\"],files:{extensions:[\".ts\"],exclude:[]},forms:[\"service-instance\"]}).read(tree,[\"src/data.ts\"],[],memo,\"reach\")'",
    "expected": "The check tells a Context.Reference<Invocation> holding a data value apart from a Context.Service implementation and does not require rewriting the data class."
  }
---
Filed from project `runlith`.

The cause is in checks/law/effect-style/sites.ts:318–358,561–562: constructed follows through to new and does not classify the provision tag. The real site is apps/tagma/server/src/external-harnesses/testing/hookDelivery.itest.ts:63; the Reference declaration and the data-class are platform/cli/verb.ts:95–112. The defect was found by effect-server-tail while finishing the migration; the production data-class is not changed for the check.
