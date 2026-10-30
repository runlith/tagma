import { Effect } from 'effect';
import type { EffortLevel, ModelInfo, ThinkingConfig } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { SessionConfigOption, SessionModeState } from '@runlith/acp/updates';
import type { Channel, ThinkingDisplay } from './channel.js';

export const MODE = 'bypassPermissions';

export const MODES: SessionModeState = {
  currentModeId: MODE,
  availableModes: [
    { id: MODE, name: 'Tagma judges its tools', description: 'Claude Code runs only Tagma tools, and the Tagma server judges every call.' },
  ],
};

export const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const DISPLAYS: readonly ThinkingDisplay[] = ['summarized', 'omitted'];

export class Settings {
  private models: readonly ModelInfo[] = [];
  private sized: number | null = null;
  private display: ThinkingDisplay | null = null;
  private installed: ThinkingDisplay | null = null;

  constructor(
    private chosenModel: string | null,
    private chosenEffort: EffortLevel | null,
    readonly titled: boolean,
  ) {}

  get model(): string | null {
    return this.chosenModel;
  }

  get effort(): EffortLevel | null {
    return this.chosenEffort;
  }

  get window(): number | null {
    return this.sized;
  }

  opening(): ThinkingConfig | undefined {
    this.installed = this.display === null || !this.adaptive(this.current()) ? null : this.display;
    return this.installed === null ? undefined : { type: 'adaptive', display: this.installed };
  }

  private current(): string {
    return this.chosenModel ?? this.models[0]?.value ?? 'default';
  }

  private named(model: string): ModelInfo | undefined {
    return this.models.find((one) => one.value === model || one.resolvedModel === model);
  }

  private adaptive(model: string): boolean {
    return this.named(model)?.supportsAdaptiveThinking !== false;
  }

  offered(models: readonly ModelInfo[], window: number): void {
    this.models = models;
    this.sized = window;
  }

  serving(model: string): void {
    this.chosenModel = model;
  }

  configOptions(): readonly SessionConfigOption[] {
    const offered = this.models.map((model) => ({ value: model.value, name: model.displayName, description: model.description }));
    const current = this.current();
    const listed = offered.some((model) => model.value === current) ? offered : [{ value: current, name: current }, ...offered];
    const named = this.named(current);
    const thinking: readonly SessionConfigOption[] = this.adaptive(current)
      ? [
          {
            id: 'thinking',
            name: 'Thinking summary',
            category: 'thought_level',
            type: 'select',
            currentValue: this.installed ?? 'omitted',
            options: DISPLAYS.map((display) => ({ value: display, name: display })),
          },
        ]
      : [];
    return [
      { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: current, options: listed },
      {
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: this.chosenEffort ?? 'high',
        options: (named?.supportedEffortLevels ?? EFFORTS).map((effort) => ({ value: effort, name: effort })),
      },
      ...thinking,
    ];
  }

  readonly configure = Effect.fnUntraced(function* (this: Settings, channel: Channel, configId: string, value: string) {
    if (configId === 'model') {
      yield* channel.setModel(value);
      this.sized = yield* channel.window();
      this.chosenModel = value;
      if (this.display !== null && this.installed !== this.display && this.adaptive(value)) yield* this.install(channel, this.display);
      return this.configOptions();
    }
    if (configId === 'effort') {
      const effort = EFFORTS.find((level) => level === value);
      if (effort === undefined) return yield* new AgentFault({ code: FAULT.invalidParams, message: `Claude Code has no effort ${value}` });
      yield* channel.setEffort(effort);
      this.chosenEffort = effort;
      return this.configOptions();
    }
    if (configId === 'thinking') {
      const display = DISPLAYS.find((one) => one === value);
      if (display === undefined)
        return yield* new AgentFault({ code: FAULT.invalidParams, message: `Claude Code has no thinking display ${value}` });
      this.display = display;
      yield* this.install(channel, display);
      return this.configOptions();
    }
    return yield* new AgentFault({ code: FAULT.invalidParams, message: `this agent has no config option ${configId}` });
  });

  private readonly install = Effect.fnUntraced(function* (this: Settings, channel: Channel, display: ThinkingDisplay) {
    yield* channel.setThinking(display);
    this.installed = display;
  });
}
