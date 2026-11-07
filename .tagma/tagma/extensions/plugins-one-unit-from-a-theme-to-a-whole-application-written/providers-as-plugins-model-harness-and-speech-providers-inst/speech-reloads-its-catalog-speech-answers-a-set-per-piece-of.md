---
id: 01a1b32e-4330-78d2-bef6-12c67cf028d8
title: "Speech reloads its catalog: Speech answers a set per piece of work, built-in and plugin speech providers come through speech's own port"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b32e-d352-77c4-9a01-abff18c5b298",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1b32d-42a6-75fa-b388-7072f70d7231
---
The Speech part of [[f70d7231]]: `Speech.layer` over a source with changes, `now`/`changes` and a `SpeechSet` bound to one catalog; every recognition, synthesis and transcription keeps its set to its end; per-provider validation with faults instead of a thrown catalog; speech's port filled by composition with the built-ins under their built-in plugins and every standing provider part's speech through `importProviders`; `KeyedProviders` read per use; the speech contract's runtime modules in the host module list; Settings → Speech following catalog changes.