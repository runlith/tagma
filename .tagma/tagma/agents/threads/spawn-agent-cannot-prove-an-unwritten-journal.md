---
id: 01a198b6-85da-7701-a90e-6a78e551b650
title: "spawn_agent в фоне падает при создании потока: \"cannot prove an unwritten journal\""
ord: 148
tags: ["reflection"]
fields:
  {
    "actual": "Два из четырёх вызовов (trc-a2a, trc-host-update) вернули AgentToolFailed: \"Thread storage failed in floor.open: thread 01a198b6-512a-73d6-bab2-6e870997c177 cannot prove an unwritten journal; nothing was created\". Два других (trc-transport, trc-worktree-modes) стартовали как потоки 01a198b6-5127-7eab-bdd8-41fe6e1c5bf1 и 01a198b6-512e-7cd2-a374-b8379c2c8f8d. Ни один отказ не указал, что делать дальше; вызовы шли с одинаковыми параметрами, кроме name и task.",
    "command": "spawn_agent {agentId: \"tagma\", provider: \"openai-oauth\", model: \"gpt-6.1-terra\", reasoning: \"xhigh\", name: \"trc-a2a\", fork: \"none\", background: true, worktree: \"inherit\", task: <длинный текст>} — четыре вызова подряд в одном ходе",
    "expected": "Каждый вызов создаёт дочерний поток, и его запуск приходит уведомлением finished/started; при сбое хранения потока отказ объясняет условие и способ выхода."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T19:32:43.457Z, from 554abb6a7.

Замечено 2026-11-01 в ходе чтения клона Traycer для оператора. Отказ происходит внутри хранения потока (floor.open), не у графа и не у контракта. Повтор без изменения условий может снова упасть; причина в журнале потока, который не удаётся доказать как ненаписанный.