import { Context } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { CapabilityDeclaration } from '../wire/capabilities.js';

export const VIEW_CAPABILITIES = new ContributionPoint<CapabilityDeclaration>('views/view-capabilities');

export class ViewCapabilities extends Context.Service<ViewCapabilities, { readonly all: readonly CapabilityDeclaration[] }>()(
  'views/ViewCapabilities',
) {}
