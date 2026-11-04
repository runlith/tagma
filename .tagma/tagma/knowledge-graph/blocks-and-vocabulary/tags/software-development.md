---
id: 01a0c0bb-e5dc-7025-b290-d259a80f00f4
title: software-development
ord: 12
tags: ["catalog"]
fields:
  {
    "id": "software-development",
    "release": {
      "guidance": "The software-development catalog connects product understanding, accepted changes and the work realizing them.\n\nWhen the product's behaviour changes, edit the block that describes it; never write a second block about the same behaviour beside it.\n\nA subtree offered as an example for other work is first read against the code by someone who did not write it: a qualified body does not repair an overbroad title.\n\nWrite for a competent reader only the distinctions, conditions and reasons they cannot reliably infer — never what code or structure already says; write from the code, never its comments: the graph cuts prose, it does not move it. An orientation body is as short as its reason; a spec, research reading or rule takes the space its complete subject needs. Another subject is another node, never a longer body; one subject's conditions stay together. Examples earn their place by resolving ambiguity. An explicit data constraint names the real consuming contract requiring it; the reason, not a character cap, measures quality. Precision is judged per sentence: a title or body promising more than the code holds is a defect.",
      "profile": {
        "checks": {
          "code": true
        }
      },
      "revision": "04af7fed5d78c7250b0be2db72cf3ac11b8ccc0399da47b8fa1b546ad70538da",
      "tags": [
        {
          "body": {
            "shape": "orientation"
          },
          "contracts": {
            "core/module": {
              "slots": {
                "entries": "entries",
                "id": "id",
                "order": "order"
              },
              "words": {}
            }
          },
          "edges": [
            "validates",
            "relates",
            {
              "kind": "imports",
              "to": [
                "module"
              ]
            },
            {
              "kind": "imports-tests",
              "to": [
                "module"
              ]
            }
          ],
          "fields": {
            "entries": {
              "name": "moduleEntries",
              "type": "schema"
            },
            "id": "string",
            "kind": {
              "type": "enum",
              "values": [
                "kit",
                "product",
                "surface",
                "substrate"
              ]
            },
            "order": {
              "name": "moduleOrder",
              "type": "schema"
            }
          },
          "gates": [
            {
              "gate": "source-required",
              "kinds": [
                "dir",
                "file"
              ]
            }
          ],
          "id": "module",
          "prompt": "A #module owns a part of the product and its dependency boundary, kept on its card: `id` keys its violations and debt, its one directory source is the root, a file source a file it owns outside it, `entries` what other modules may import of it, `imports` and `imports-tests` what its code and test code may import, `order` its floors, bottom first. Every commit's import check reads the cards; set_module writes them, measuring every enforced rule the change moves; title, body and kind are edited freely. A module stands under the area of what the user gets, wherever its code lies; one making up an application as a whole stands under that application's card, a group with no code of its own. Draw boundaries where dependency boundaries are real, by product meaning, never by copying the directory tree. The body is one paragraph in the product's words — why the product has it, what it owns, what it leaves to callers, a sentence each — never what fields and edges carry. Kind is its primary responsibility: kit — imported by other code; product — delivered to a user; surface — how a user or agent reaches the product; substrate — what the rest runs on. Obligations on anyone working inside it are rules. Write its subtree after reading its code, never a sample — every file whole if the module is small enough, else its exported surface — the module first, then an #explanation per lasting part needing one. An existing subtree's affected owners are read and revised, never recreated; where code contradicts the module or its explanations, correct the module first.",
          "roles": {
            "container": true
          },
          "sections": [
            {
              "key": "module",
              "text": "A #module owns a part of the product and its dependency boundary, kept on its card: `id` keys its violations and debt, its one directory source is the root, a file source a file it owns outside it, `entries` what other modules may import of it, `imports` and `imports-tests` what its code and test code may import, `order` its floors, bottom first. Every commit's import check reads the cards; set_module writes them, measuring every enforced rule the change moves; title, body and kind are edited freely. A module stands under the area of what the user gets, wherever its code lies; one making up an application as a whole stands under that application's card, a group with no code of its own. Draw boundaries where dependency boundaries are real, by product meaning, never by copying the directory tree. The body is one paragraph in the product's words — why the product has it, what it owns, what it leaves to callers, a sentence each — never what fields and edges carry. Kind is its primary responsibility: kit — imported by other code; product — delivered to a user; surface — how a user or agent reaches the product; substrate — what the rest runs on. Obligations on anyone working inside it are rules. Write its subtree after reading its code, never a sample — every file whole if the module is small enough, else its exported surface — the module first, then an #explanation per lasting part needing one. An existing subtree's affected owners are read and revised, never recreated; where code contradicts the module or its explanations, correct the module first."
            },
            {
              "edits": [
                "append"
              ],
              "key": "project",
              "text": ""
            }
          ],
          "sources": [
            "dir",
            "file"
          ]
        },
        {
          "body": {
            "shape": "content"
          },
          "contracts": {
            "core/explanation": {
              "slots": {},
              "words": {}
            }
          },
          "edges": [
            "validates",
            "relates"
          ],
          "fields": {},
          "gates": [],
          "id": "explanation",
          "prompt": "An #explanation states a lasting part of the code a reader cannot recover from it: a contract several files or modules keep, an invariant and what breaks without it, a format, or a choice and the alternative it rejected. Its sources name the narrowest code that could contradict it; each session receives it once, on first reading or writing that code. The title states the fact and reads alone. The body holds only the reason, boundary, failure prevented or trade — never the code read back: no walk through functions, no list of fields or parameters, no constant's value — say what the constant must outlast. Measurements and how it was built belong to the task that did the work. A word of totality — every, only, never — is written after reading each place it covers: a universal statement the code breaks is worse than silence. A change breaking an explanation corrects it in the same change. A plain note may also name code with sources; this tag adds delivery on code reads and writes.",
          "roles": {},
          "sections": [
            {
              "key": "explanation",
              "text": "An #explanation states a lasting part of the code a reader cannot recover from it: a contract several files or modules keep, an invariant and what breaks without it, a format, or a choice and the alternative it rejected. Its sources name the narrowest code that could contradict it; each session receives it once, on first reading or writing that code. The title states the fact and reads alone. The body holds only the reason, boundary, failure prevented or trade — never the code read back: no walk through functions, no list of fields or parameters, no constant's value — say what the constant must outlast. Measurements and how it was built belong to the task that did the work. A word of totality — every, only, never — is written after reading each place it covers: a universal statement the code breaks is worse than silence. A change breaking an explanation corrects it in the same change. A plain note may also name code with sources; this tag adds delivery on code reads and writes."
            },
            {
              "edits": [
                "append"
              ],
              "key": "project",
              "text": ""
            }
          ],
          "sources": [
            "file",
            "dir",
            "symbol"
          ]
        }
      ]
    },
    "tags": [
      "904a49e2",
      "59890ef8"
    ]
  }
---
The software-development catalog connects product understanding, accepted changes and the work realizing them.

When the product's behaviour changes, edit the block that describes it; never write a second block about the same behaviour beside it.

A subtree offered as an example for other work is first read against the code by someone who did not write it: a qualified body does not repair an overbroad title.

Write for a competent reader only the distinctions, conditions and reasons they cannot reliably infer — never what code or structure already says; write from the code, never its comments: the graph cuts prose, it does not move it. An orientation body is as short as its reason; a spec, research reading or rule takes the space its complete subject needs. Another subject is another node, never a longer body; one subject's conditions stay together. Examples earn their place by resolving ambiguity. An explicit data constraint names the real consuming contract requiring it; the reason, not a character cap, measures quality. Precision is judged per sentence: a title or body promising more than the code holds is a defect.