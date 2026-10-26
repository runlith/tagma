import { writes } from '../../platform/contract/service/writes.js';
import { session } from '../../platform/store/writers.js';
import { block, blockField, blockTag, edge, event, farEdge, meta, ref, searchIndex, source } from './tables.js';

export const acting = writes('Act', [event, session, meta, blockTag]);

export const projecting = writes('BlockProjection', [searchIndex, blockTag, blockField]);

export const referencing = writes('BlockReferences', [ref]);

export const linking = writes('Edges.insert', [edge, farEdge]);

export const placing = writes('Sources.place', [source, block], projecting);
