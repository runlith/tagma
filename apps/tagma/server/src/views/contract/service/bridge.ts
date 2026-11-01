import { Context } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { BridgeMethod } from '../wire/bridge.js';

export const BRIDGE_METHODS = new ContributionPoint<BridgeMethod>('views/bridge-methods');

export class BridgeMethods extends Context.Service<BridgeMethods, { readonly all: readonly BridgeMethod[] }>()('views/BridgeMethods') {}
