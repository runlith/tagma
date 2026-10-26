import { Data } from 'effect';
import type { WorkflowDefinition } from './definition';
import { compileWorkflow, parseWorkflowDefinition, type WorkflowVocabulary } from './compile';
import type { WorkflowPlan } from './plan';

export type WorkflowSource = {
  readonly floor: 'project' | 'user';
  readonly definition: WorkflowDefinition;
  readonly revision: string;
};

export type WorkflowCatalog = {
  readonly resolved: readonly WorkflowResolution[];
  readonly rejected: readonly { readonly name: string; readonly floor: WorkflowSource['floor']; readonly reason: string }[];
};

export type WorkflowResolution = {
  readonly name: string;
  readonly floor: WorkflowSource['floor'];
  readonly revision: string;
  readonly plan: WorkflowPlan;
};

export class WorkflowUnknownError extends Data.TaggedError('WorkflowUnknown')<{ readonly message: string; readonly workflow: string }> {
  constructor(workflow: string) {
    super({ message: `No workflow is saved as ${workflow}.`, workflow });
    this.name = 'WorkflowUnknownError';
  }
}

export type WorkflowUnread = {
  readonly floor: WorkflowSource['floor'];
  readonly path: string;
  readonly reason: string;
};

export class WorkflowLibrary {
  constructor(
    private readonly sources: readonly WorkflowSource[],
    private readonly held: { readonly seams: readonly string[]; readonly conditions: readonly string[] },
    private readonly unread: readonly WorkflowUnread[] = [],
  ) {}

  list(): WorkflowCatalog {
    const winners = new Map<string, WorkflowSource>();
    for (const source of this.sources) {
      const standing = winners.get(source.definition.name);
      if (!standing || (standing.floor === 'user' && source.floor === 'project')) {
        winners.set(source.definition.name, source);
      }
    }
    const vocabulary: WorkflowVocabulary = {
      seams: new Set(this.held.seams),
      conditions: new Set(this.held.conditions),
      workflows: new Set(winners.keys()),
    };
    const resolved: WorkflowResolution[] = [];
    const rejected: { name: string; floor: WorkflowSource['floor']; reason: string }[] = [];
    for (const source of winners.values()) {
      try {
        resolved.push({
          name: source.definition.name,
          floor: source.floor,
          revision: source.revision,
          plan: compileWorkflow(source.definition, source.revision, vocabulary),
        });
      } catch (failure) {
        rejected.push({
          name: source.definition.name,
          floor: source.floor,
          reason: failure instanceof Error ? failure.message : 'does not compile',
        });
      }
    }
    for (const file of this.unread) rejected.push({ name: file.path, floor: file.floor, reason: file.reason });
    return { resolved, rejected };
  }

  resolve(name: string): WorkflowResolution | WorkflowUnknownError {
    return this.list().resolved.find((entry) => entry.name === name) ?? new WorkflowUnknownError(name);
  }

  static parse(value: unknown): WorkflowDefinition {
    return parseWorkflowDefinition(value);
  }
}
