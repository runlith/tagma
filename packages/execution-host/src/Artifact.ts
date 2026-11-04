import type { ArtifactManifest } from '@runlith/executions/protocol/artifact';

export type CodeSigning = { readonly identity: string; readonly timestamp: boolean };
type CodeSealed = { readonly _tag: 'Signed' } | { readonly _tag: 'Refused'; readonly detail: string };

export type NativeArtifact = {
  readonly platform: ArtifactManifest['platform'];
  readonly endpoint: ArtifactManifest['endpoint'];
  readonly library: string;
  readonly holder: string;
  readonly triple: string | undefined;
  readonly seal: (path: string, signing: CodeSigning) => CodeSealed;
};

export type ArtifactAdapter = {
  readonly os: string;
  readonly workers: readonly string[];
  readonly artifact: (arch: string) => NativeArtifact;
};
