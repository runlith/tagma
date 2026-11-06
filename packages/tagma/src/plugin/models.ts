import type { StandardSchemaV1 } from '@standard-schema/spec';
import { issueText } from './issues.js';
import type { ExternalOperations } from './operations.generated.js';
import type { InputSchema, TagmaClient } from './plugin.js';

type Asked = ExternalOperations['ask_model']['input'];

type AskOptions = Pick<Asked, 'system' | 'model'>;

export type ModelsClient = {
  readonly ask: {
    (prompt: string, options?: AskOptions): Promise<string>;
    <S extends InputSchema>(prompt: string, options: AskOptions & { readonly schema: S }): Promise<StandardSchemaV1.InferOutput<S>>;
  };
};

export const modelsClient = (tagma: TagmaClient): ModelsClient => {
  function ask(prompt: string, options?: AskOptions): Promise<string>;
  function ask<S extends InputSchema>(
    prompt: string,
    options: AskOptions & { readonly schema: S },
  ): Promise<StandardSchemaV1.InferOutput<S>>;
  async function ask(prompt: string, options: AskOptions & { readonly schema?: InputSchema } = {}): Promise<unknown> {
    const { schema, ...named } = options;
    if (schema === undefined) {
      const answered = await tagma.op('ask_model', { prompt, ...named });
      if (answered.status !== 'text') throw new Error(`ask_model answered ${answered.status} to a text ask`);
      return answered.text;
    }
    const { $schema: _, ...shape } = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
    const answered = await tagma.op('ask_model', { prompt, ...named, schema: shape });
    if (answered.status !== 'object') throw new Error(`ask_model answered ${answered.status} to an object ask`);
    const checked = await schema['~standard'].validate(answered.value);
    if (checked.issues !== undefined)
      throw new Error(`the model's answer does not match the schema: ${checked.issues.map(issueText).join('; ')}`);
    return checked.value;
  }
  return { ask };
};
