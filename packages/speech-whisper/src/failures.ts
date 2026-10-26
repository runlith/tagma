import { SpeechFailure } from '@runlith/speech/wire/failure';
import type { EngineFailure, ModelBusy, QueueFull } from './engine/failures.ts';
import type { ModelMissing, ModelUnknown, StoreFailed } from './models/failures.ts';

const lasting = new Set(['model-missing', 'model-load-failed', 'language-unsupported', 'detector-unavailable', 'protocol']);

export const speechFailure = (
  failure: EngineFailure | QueueFull | ModelBusy | ModelUnknown | ModelMissing | StoreFailed,
): SpeechFailure => {
  switch (failure._tag) {
    case 'EngineCrashed':
    case 'DetectorBehind':
    case 'QueueFull':
    case 'ModelBusy':
      return SpeechFailure.provider(failure.message, true);
    case 'EngineRefused':
      return SpeechFailure.provider(failure.message, !lasting.has(failure.code));
    case 'ModelUnknown':
      return SpeechFailure.invalidRequest(failure.message);
    case 'EngineUnavailable':
    case 'ModelMissing':
    case 'StoreFailed':
      return SpeechFailure.unsupported(failure.message);
  }
};
