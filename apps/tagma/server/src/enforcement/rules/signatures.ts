import { ruleSignatures } from '../../../../../../packages/tagma/kit/rules.ts' with { type: 'macro' };

export const SIGNATURES: Readonly<Record<string, string>> = await ruleSignatures();
