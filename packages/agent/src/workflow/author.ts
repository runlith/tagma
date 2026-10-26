import type { WorkflowDefinition, WorkflowSignature, WorkflowStep, WorkflowTransition } from './definition';
import { compileWorkflow, type WorkflowVocabulary } from './compile';
import type { WorkflowPlan } from './plan';

export class WorkflowAuthor {
  private readonly steps: WorkflowStep[] = [];
  private readonly transitions: WorkflowTransition[] = [];

  constructor(
    private readonly name: string,
    private readonly description = '',
    private readonly signature: WorkflowSignature = {},
  ) {}

  step(step: WorkflowStep): this {
    this.steps.push(step);
    return this;
  }

  then(from: string, to: string, when?: string): this {
    this.transitions.push(when === undefined ? { from, to } : { from, to, when });
    return this;
  }

  definition(): WorkflowDefinition {
    return {
      name: this.name,
      description: this.description,
      input: this.signature,
      steps: this.steps,
      transitions: this.transitions,
    };
  }

  compile(revision: string, vocabulary: WorkflowVocabulary): WorkflowPlan {
    return compileWorkflow(this.definition(), revision, vocabulary);
  }
}
