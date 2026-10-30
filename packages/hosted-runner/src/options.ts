import { Effect, Schema } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { SessionConfigOption } from '@runlith/acp/updates';
import type { ModelSwitches } from '@runlith/llm/models/description';

export type ClientSelection = {
  readonly model: string | null;
  readonly effort: string | null;
  readonly parameters: ModelSwitches;
};

export type ClientLaunch = ClientSelection & { readonly version: string };

export class Options {
  private model: string | null;
  private effort: string | null;
  private parameters: ModelSwitches;

  constructor(
    launch: ClientLaunch,
    private readonly supportsParameters: boolean,
  ) {
    this.model = launch.model;
    this.effort = launch.effort;
    this.parameters = launch.parameters;
  }

  read(): ClientSelection {
    return { model: this.model, effort: this.effort, parameters: this.parameters };
  }

  options = (): readonly SessionConfigOption[] => [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: this.model ?? '',
      options: [{ value: this.model ?? '', name: this.model ?? 'Default' }],
    },
    {
      id: 'effort',
      name: 'Reasoning',
      category: 'thought_level',
      type: 'select',
      currentValue: this.effort ?? '',
      options: [{ value: this.effort ?? '', name: this.effort ?? 'Default' }],
    },
    {
      id: 'parameters',
      name: 'Parameters',
      type: 'select',
      currentValue: JSON.stringify(this.parameters),
      options: [{ value: JSON.stringify(this.parameters), name: 'Parameters' }],
    },
  ];

  configure = Effect.fnUntraced(function* (this: Options, id: string, value: string) {
    if (id === 'model') this.model = value || null;
    else if (id === 'effort') this.effort = value || null;
    else if (id === 'parameters') {
      const failed = (cause: unknown) => new AgentFault({ code: FAULT.invalidParams, message: String(cause) });
      const parameters = yield* Effect.try({ try: () => JSON.parse(value) as unknown, catch: failed }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.String))),
        Effect.mapError(failed),
      );
      if (!this.supportsParameters && Object.keys(parameters).length > 0)
        return yield* new AgentFault({ code: FAULT.invalidParams, message: 'This agent has no declared additional parameters' });
      this.parameters = parameters;
    } else return yield* new AgentFault({ code: FAULT.invalidParams, message: `This agent has no configuration option ${id}` });
    return this.options();
  });
}
