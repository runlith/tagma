import { type KindDeclaration, productKindDeclaration } from './contribution.js';
import { compositionKind } from './productRecords.js';

export const kinds: readonly KindDeclaration[] = [productKindDeclaration(compositionKind)];
