import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const nativeHarness = {
  id: 'native-harness',
  title: 'Native threads and agent invocations',
  operations: async () => {
    const [
      { CONTEXT_OPERATIONS },
      { INPUT_OPERATIONS },
      { COMPACTION_OPERATIONS },
      { MODEL_OPERATIONS },
      { CALL_OPERATIONS },
      { WORKFLOW_OPERATIONS },
      { SKILL_OPERATIONS },
      { EVIDENCE_OPERATIONS },
      { NATIVE_AGENT_OPERATIONS },
      { CAPABILITY_OPERATIONS },
      { REFUSAL_WORDS },
    ] = await Promise.all([
      import('./operations/context.js'),
      import('./operations/inputs.js'),
      import('./operations/compaction.js'),
      import('./operations/models.js'),
      import('./operations/calls.js'),
      import('./operations/workflows.js'),
      import('./operations/skills.js'),
      import('./operations/evidence.js'),
      import('./operations/agents.js'),
      import('./operations/capabilities.js'),
      import('./refusalWords.js'),
    ]);
    return {
      declarations: mergeOperations(
        INPUT_OPERATIONS,
        COMPACTION_OPERATIONS,
        MODEL_OPERATIONS,
        CALL_OPERATIONS,
        WORKFLOW_OPERATIONS,
        SKILL_OPERATIONS,
        EVIDENCE_OPERATIONS,
        CONTEXT_OPERATIONS,
        NATIVE_AGENT_OPERATIONS,
        CAPABILITY_OPERATIONS,
      ),
      refusals: REFUSAL_WORDS,
    } as const;
  },
} as const satisfies OperationManifest;
