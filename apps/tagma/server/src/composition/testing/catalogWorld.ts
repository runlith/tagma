import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { kind } from '@runlith/testbed/worlds';
import { Effect } from 'effect';
import { OperationCatalog } from '../../invocation/contract/service/catalog.js';
import { operationCatalog } from '../operationCatalog.js';
import { ASSEMBLY } from './composed.js';

export const catalogWorld = kind(OperationCatalog, () => Effect.provide(operationCatalog(ASSEMBLY), approvalModesLayer));
