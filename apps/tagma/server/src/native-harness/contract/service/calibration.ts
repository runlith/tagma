import { Context } from 'effect';
import type { ThreadCalibrationProfileStore } from '@runlith/agent/thread/compaction/calibration';

export class CalibrationProfiles extends Context.Service<CalibrationProfiles, ThreadCalibrationProfileStore>()(
  'tagma/native-harness/CalibrationProfiles',
) {}
