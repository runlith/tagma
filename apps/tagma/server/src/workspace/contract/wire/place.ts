import * as Schema from 'effect/Schema';
import { IdentityWitness } from '@runlith/files/namespace';
import { ResourceAddress } from '@runlith/files/resource';
import { witnessTuple } from '@runlith/files/witness';
import { EnvironmentBinding } from './environments.js';
import { RootBinding } from './roots.js';
import { WorkspaceGeneration } from './ids.js';

export const WorkOrigin = Schema.Struct({
  projectId: Schema.Int,
  threadId: Schema.NonEmptyString,
});
export type WorkOrigin = typeof WorkOrigin.Type;

export const ProvedRoot = Schema.Struct({
  environment: EnvironmentBinding,
  root: ResourceAddress,
  witness: IdentityWitness,
  registration: Schema.NullOr(RootBinding),
});
export type ProvedRoot = typeof ProvedRoot.Type;

export const WorkingRoot = Schema.Struct({
  ...ProvedRoot.fields,
  generation: WorkspaceGeneration,
});
export type WorkingRoot = typeof WorkingRoot.Type;

export const WorkingOrigin = Schema.Struct({
  ...WorkingRoot.fields,
  work: WorkOrigin,
});
export type WorkingOrigin = typeof WorkingOrigin.Type;

export type PlacedPath = {
  readonly checkout: string;
  readonly path: string;
};

export const witnessKey = (witness: IdentityWitness): string => JSON.stringify(witnessTuple(witness));

export type TargetAt = {
  readonly threadId: string;
  readonly runId: string;
  readonly generation: WorkspaceGeneration;
};

export const encodeBinding = (tuple: readonly string[]): string => Buffer.from(JSON.stringify(tuple), 'utf8').toString('base64url');

export const lexicalPath = (path: string): string => {
  if (!path.startsWith('/')) return path;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
};
