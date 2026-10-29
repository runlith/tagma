---
id: 01a132c1-2a4b-72d0-8b93-e7d30dd31ced
title: An incomplete builtin input is wrongly called a new-build field
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "A body-shape refusal: \"The running server does not know the input field `inspection.builtin`\", advising a server restart. This installation's read_operations declares builtin=platforms and required params fields. Finding the missing keys took reading the whole heavy union-schema.",
    "command": "tagma:try op enforce_rule --json '{\"blockId\":\"a6068c50\",\"base\":null,\"strictness\":\"gate\",\"on\":[{\"op\":\"submit_work\",\"phase\":\"before\"}],\"inspection\":{\"builtin\":\"platforms\",\"params\":{\"base\":\"\",\"files\":{\"extensions\":[\".ts\"],\"exclude\":[]},\"apps\":[],\"packages\":{},\"refuses\":{\"bun\":[\"node:fs\"]}}}}'",
    "expected": "body-shape names the missing required inspection.params.allows, built and leaves; builtin is a declared field of the current read_operations."
  }
---
Filed from project `runlith`.
