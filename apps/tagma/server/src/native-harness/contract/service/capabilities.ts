import { Context } from 'effect';
import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export type DeclaredCapability = {
  readonly owner: string;
  readonly declaration: CapabilityDeclaration;
};

export class DeclaredCapabilities extends Context.Service<DeclaredCapabilities, readonly DeclaredCapability[]>()(
  'tagma/native-harness/DeclaredCapabilities',
) {}
