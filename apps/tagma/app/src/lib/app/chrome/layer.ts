import { Layer } from '@runlith/layer/Layer';
import { Attention } from '../attention/Attention.svelte.js';
import { Awake } from '$lib/features/power/Awake.svelte.js';
import { Pace } from '$lib/features/power/Pace.svelte.js';
import { Push } from '$lib/features/devices/Push.svelte.js';
import CommandPalette from './CommandPalette.svelte';
import { NoticeColumn } from '../../features/notices/overlay.js';
import NoticeCards from './NoticeCards.svelte';
import { Bar } from '../panes/Bar.svelte.js';
import { Frame } from './FrameState.svelte.js';
import { Palette } from '../panes/palette.js';
import { ExecutionActs } from '../../features/executions/acts.svelte.js';
import { Readings } from '../../features/executions/load/Readings.svelte.js';
import { View } from '../../features/executions/load/View.svelte.js';
import { Switcher } from '../../features/projects/Cycle.svelte.js';
import ProjectSwitcher from '../../features/projects/Switcher.svelte';
import { ProjectCreation } from './ProjectCreation.svelte.js';
import { RailPins } from './RailPins.svelte.js';
import { ServerFaults } from './ServerFaults.svelte.js';
import { Standing } from './Standing.svelte.js';
import { WireState } from './WireState.svelte.js';

export const FrameLayer = Layer.mergeAll(
  Bar,
  Frame,
  WireState,
  Standing,
  Awake,
  Pace,
  Attention,
  ServerFaults,
  Push,
  ExecutionActs,
  Readings,
  View,
  ProjectCreation,
  RailPins,
  Palette.present(CommandPalette),
  Switcher.present(ProjectSwitcher, () => ({ priority: 1, disallowCoexistWith: [{ id: Palette.id }] })),
  NoticeColumn.present(NoticeCards),
);
