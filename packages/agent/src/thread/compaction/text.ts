export type ThreadCompactionText = {
  readonly checkpointMarker: string;
  readonly prunedToolOutput: string;
  readonly overflowMediaGuidance: string;
  omittedMedia(mediaType: string | undefined): string;
};
