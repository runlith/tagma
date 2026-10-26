import { expect, test } from 'bun:test';
import { profileFrames, type CpuProfileArtifact } from './CpuProfile.js';

const artifact: CpuProfileArtifact = {
  nodes: [
    { id: 1, callFrame: { functionName: 'beforeTheFreeze', url: 'file:///a.ts', lineNumber: 10 }, children: [] },
    { id: 2, callFrame: { functionName: 'spawnSync', url: 'file:///submitWork.ts', lineNumber: 365 }, children: [] },
  ],
  startTime: 1_000,
  endTime: 5_000,
  samples: [1, 1, 2, 2],
  timeDeltas: [1_000, 1_000, 1_000, 1_000],
};

test('a sample taken after an idle gap weighs one sampling period, not the gap the runtime did not sample', () => {
  const afterIdle: CpuProfileArtifact = {
    ...artifact,
    samples: [1, 1, 1, 2],
    timeDeltas: [1_000, 1_000, 1_000, 500_000],
    endTime: 504_000,
  };
  expect(profileFrames(afterIdle).map((frame) => [frame.functionName, frame.selfMs, frame.samples])).toEqual([
    ['beforeTheFreeze', 3, 3],
    ['spawnSync', 1, 1],
  ]);
});

test('a window where idle gaps outnumber the busy samples still weighs each sample by the sampling period', () => {
  const mostlyIdle: CpuProfileArtifact = {
    ...artifact,
    samples: [1, 1, 2, 2],
    timeDeltas: [1_000, 400_000, 1_000, 600_000],
    endTime: 1_003_000,
  };
  expect(profileFrames(mostlyIdle).map((frame) => [frame.functionName, frame.selfMs])).toEqual([
    ['beforeTheFreeze', 2],
    ['spawnSync', 2],
  ]);
});
