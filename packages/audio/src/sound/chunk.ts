import { type Format, isWhole } from './format.ts';

export type Chunk = {
  readonly _tag: 'Chunk';
  readonly at: bigint;
  readonly pcm: Int16Array;
};

export class PartialFrame extends Error {
  constructor(
    readonly samples: number,
    readonly channels: number,
  ) {
    super(`a chunk of ${samples} samples does not hold whole frames of ${channels} channels`);
    this.name = 'PartialFrame';
  }
}

export const chunk = (format: Format, at: bigint, pcm: Int16Array): Chunk => {
  if (!isWhole(format, pcm)) throw new PartialFrame(pcm.length, format.channels);
  return { _tag: 'Chunk', at, pcm };
};
