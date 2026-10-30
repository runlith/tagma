import { Service } from '@runlith/layer/key';
import type { AskChoice, AskControl } from '@tagma/server/platform/contract/wire/setting';
import type { Component } from 'svelte';

export type ModelFieldProps = {
  label: string;
  value: AskChoice | null;
  ask?: AskControl['of'];
  chip?: boolean;
  blank?: string;
  disabled?: boolean;
  onpick: (choice: AskChoice) => void;
  onautomatic?: () => void;
};

export type ModelFieldComponent = Component<ModelFieldProps>;

export interface ModelFieldPort {
  readonly field: ModelFieldComponent;
}

export class ModelFields extends Service<ModelFieldPort>()('ModelFields', { tier: 'app' }) {}
