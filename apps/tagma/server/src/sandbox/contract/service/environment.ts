import { Context } from 'effect';
import type { EnvironmentBackend } from '../../../workspace/contract/service/environments.js';

export class SandboxEnvironment extends Context.Service<SandboxEnvironment, { readonly backend: EnvironmentBackend }>()(
  'tagma/sandbox/SandboxEnvironment',
) {}
