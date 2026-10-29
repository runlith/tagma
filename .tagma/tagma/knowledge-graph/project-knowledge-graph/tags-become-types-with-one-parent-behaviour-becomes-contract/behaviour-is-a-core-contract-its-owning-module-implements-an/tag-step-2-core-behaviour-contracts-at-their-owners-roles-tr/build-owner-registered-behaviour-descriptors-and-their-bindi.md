---
id: 01a0f506-7376-7fe6-ad77-231f974b0baf
title: Build owner-registered behaviour descriptors and their binding compatibility before the full role migration
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46b4-7a20-8471-e0b5877ba8f0
---
Independently buildable descriptor-registration part of [[fe92fe63]] / [[877ba8f0]]. Class: complex, Opus high. Owns the behaviour contribution contract, module-manifest registration, descriptor requirements and binding compatibility. The inheritance compiler remains owned by tag-step-1; identity and aliases by tag-ids; shipped catalog declarations/profile by tag-library.

Read the current module manifest contribution mechanism before extending it. This is one registered contract per real behaviour owner, with a descriptor for fields, semantics, actions and requirements, not another closed list of roles. Define the minimal real compile input/output and send it to the lead and compiler owner before a shared schema is changed. A pure expansion of registered bindings may proceed independently; the existing gate machine must be reused, not reproduced. Module-owned descriptors and their actual consumers move together.

Enforcement owns its law/enforced descriptors and predicate consumers. The graph declares their generic contribution point below enforcement; the law team fills it. No import from graph into enforcement. The first deliverable proves registration and compatibility (including shared dependency deduplication and one owner of single-valued state), and has at least one real behaviour consumer. Parent [[fe92fe63]] stays open until every old role has its decided contract and its old answers are preserved; no global mechanical string replacement or compatibility reader becomes the final model.
