import type { Component } from 'svelte';

export type ModelFieldProps = {
  label: string;
  provider: string;
  model: string;
  disabled?: boolean;
  onpick: (provider: string, model: string) => void;
};

export const MODEL_FIELD = Symbol('settings.modelField');

export type ModelFieldComponent = Component<ModelFieldProps>;
