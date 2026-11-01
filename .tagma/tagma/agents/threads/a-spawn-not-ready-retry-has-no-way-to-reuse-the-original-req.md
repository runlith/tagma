---
id: 01a198b5-5787-7801-bd59-0ccd8199df9f
title: A spawn-not-ready retry has no way to reuse the original request
ord: 147
tags: ["reflection"]
fields:
  {
    "actual": "Four parallel starts returned spawn-not-ready with 'full-fsync worker is occupied under a held resource' and told the caller to ask again under the same request. Repeating the exact first call returned name-taken for the unstarted child; the tool exposes no request identifier to reuse. All four requested readings remained unstarted.",
    "command": "spawn_agent(agentId=\"tagma\", provider=\"openai-oauth\", model=\"gpt-6.1-terra\", reasoning=\"xhigh\", name=\"tagma-graph-reading\", task=\"Для глубокого сравнения Tagma с Traycer прочитай Tagma по исходникам в зоне графа знаний, правил, принятия/поиска знаний и связей с файлами: `apps/tagma/server/src/graph/`, `.../enforcement/`, их действительно необходимые контракты, смежные packages. Другие изучают агентов, модели, инструменты и Git, не заходи в них ради объёма. Оператор требует минимум 300–400k токенов исходников КАЖДОГО проекта суммарно. Твоя доля — ориентировочно 120–150k токенов уникального исходного текста, не включая дубли/промпты/выводы/одни только названия файлов. Читай код, не только grep. Ориентир по объёму 450–600k символов уникального кода, но это лишь приближение, не измеренное число токенов. Учитывай, что read обрезает файлы и длинные строки: не записывай как прочитанные строки, которые не вывелись. Веди перечень полных путей и диапазонов, точные байты/символы прочитанного и способ подсчёта, токены только при реальном подсчёте; сообщи существенные факты, пользовательские сценарии, ограничения, конкретные file:line. Не меняй ничего, не создавай графовых блоков, не запускай продукт/тесты. Делегируй при необходимости только Terra или Haiku.\")",
    "expected": "Start the child, or let the caller retry the same spawn request to finish provisioning it as the refusal instructs."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T19:32:43.457Z, from 554abb6a7.

The first refusal named request `envelope:spawn:01a198aa-d1ae-7ed4-a99b-08db35af2718:call_5e2eca1a785346eeaea2d13a493db5c8` and child `01a198b4-d118-7cc8-af86-b478dc04e311`. Its retry was refused because that same child already held the requested name.