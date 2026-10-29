---
id: 01a145a0-5989-7ec7-a953-f34479ddb833
title: swift test --filter regex wrongly read as a file path
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "After the tests Tagma called FileSystem.stat on the checkout path assembled from the whole filter regex and reported that the files printed by the command could not be parsed. The Swift test itself ended with two concrete failing tests.",
    "command": "swift test -j 3 --filter 'ServerUI|ConvertToModelMessagesTests|ProcessUIMessageStreamTests|ValidateUIMessagesTests|UIMessageChunkTests|ReadUIMessageStreamTests|HandleUIMessageStreamFinishTests|CreateUIMessageStreamTests|TransformFullToUIMessageStreamTests|CreateUIMessageStreamResponseTests|PipeUIMessageStreamToResponseTests|OpenAIChatToolResultCrashRegressionTests|AgentTests/respondConvertsMessages'",
    "expected": "The --filter value is treated as a test-selection regex; instruction reading covers only real source files from the Swift diagnostics."
  }
---
Filed from project `<project>`.
