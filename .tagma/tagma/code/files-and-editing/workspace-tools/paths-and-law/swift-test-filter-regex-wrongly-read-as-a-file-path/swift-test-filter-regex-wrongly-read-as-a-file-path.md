---
id: 01a145bb-a78c-75bc-b662-d12cc38cb327
title: swift test filter regex wrongly read as a file path
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "After exit 1 from a real compile error Tagma added Unknown: FileSystem.stat for ~/.tagma-dev/worktrees/<project>/ai-media/EmbedTests|EmbedManyTests|GenerateImageTests|GenerateVideoTests|GenerateSpeechTests|TranscribeTests|RerankTests|UploadFileTests|UploadSkillTests|ProviderRegistryTests|ResolveModelV4Tests|DataURLTests|SerialJobExecutorTests|DetectMediaTypeTests|ModelMessageCodableTests and claimed it could not tell the printed files apart. One false diagnostic was added; the command itself completed normally in 1m41s.",
    "command": "bash(command=\"set -o pipefail; swift build -j 3 2>&1 | rg 'error:|Build complete' && swift test -j 3 --filter 'EmbedTests|EmbedManyTests|GenerateImageTests|GenerateVideoTests|GenerateSpeechTests|TranscribeTests|RerankTests|UploadFileTests|UploadSkillTests|ProviderRegistryTests|ResolveModelV4Tests|DataURLTests|SerialJobExecutorTests|DetectMediaTypeTests|ModelMessageCodableTests' 2>&1 | rg 'error:|Build complete|Suite .* (passed|failed)|Test run|recorded an issue|✘'\", waitMs=1000, lifeMs=600000)",
    "expected": "Keep the command's exit and diagnostics; the --filter regex argument is not a checkout path."
  }
---
Filed from project `<project>`.
