---
id: 01a1926c-7cd7-7f72-93b8-d4148f301071
title: "Per-process GPU time sources by OS: macOS measured, Linux and Windows documented only"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "macOS 26.0.1 (25A362) on Apple M2 Max, measured; Linux kernel docs and source, Microsoft Learn, Electron, NVIDIA NVML pages, documented",
      "ref": "sw_vers ProductVersion 26.0.1, BuildVersion 25A362; Darwin 25.0.0 xnu-12377.1.9~141; SDK MacOSX26.0.sdk mach/task_info.h and sys/resource.h; kernel docs kernel.org/doc/html/v5.19, v6.6, v6.8, v6.10, v6.12/gpu/drm-usage-stats.html and raw master Documentation/gpu/drm-usage-stats.rst; raw tag v5.18 has no drm-usage-stats.rst (404); https://man7.org/linux/man-pages/man5/proc_pid_fdinfo.5.html; https://raw.githubusercontent.com/torvalds/linux/master/fs/proc/fd.c; https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/; https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmthk/nf-d3dkmthk-d3dkmtquerystatistics; https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmthk/ne-d3dkmthk-d3dkmt_querystatistics_type; https://learn.microsoft.com/en-us/windows-hardware/drivers/display/wddm-2-0-and-windows-10; https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-groups; https://www.electronjs.org/docs/latest/api/app; https://www.electronjs.org/docs/latest/api/structures/process-metric; https://docs.nvidia.com/deploy/archive/R470/nvml-api/group__nvmlUtil.html; https://docs.nvidia.com/deploy/archive/R470/nvml-api/group__nvmlDeviceQueries.html; https://nvidia.github.io/cuda-python/pr-preview/pr-3026/cuda-bindings/latest/module/generated/cuda.bindings.nvml.device_get_process_utilization.html; third-party, unverified: https://seclists.org/fulldisclosure/2026/Aug/77, https://docs.rs/gpuviewer-core/latest/gpuviewer_core/wddm/pdh/index.html, https://docs.rs/crate/gpui-fps/0.6.1/source/src/gpu/windows.rs"
    }
  }
edges:
  - kind: relates
    to: 01a1924a-43e4-7c7c-b5a3-e051940ea00a
---
Question: which per-process GPU time or utilization source an unprivileged process can read on each OS, at what cost, accuracy and limits, and whether it attributes GPU time to an Electron GPU process. Labels: **Measured** = read on the reading host; **Documented** = a cited kernel, vendor or Microsoft page; **Inferred** = reasoned from those, not tested.

## macOS — measured

Host: macOS 26.0.1 (build 25A362), Darwin 25.0.0 (xnu-12377.1.9~141), Mac14,6, Apple M2 Max, 30 GPU cores (`AGXAcceleratorG14X`), 2026-10-31.

- **Source.** `AppUsage` is carried only by `AGXDeviceUserClient`: all 71 AGX clients carry it, and no other class does, including the `IOSurfaceRootUserClient` a GPU process also holds. `AppUsage` has one `{API, lastSubmittedTime, accumulatedGPUTime}` entry per Metal command queue (only `API="Metal"` seen). `IOUserClientCreator` is `pid N, <name>`, where the name is the executable name cut to 16 characters.
- **Unit.** `accumulatedGPUTime` is nanoseconds of GPU busy time. Over 14.85 s (8 snapshots) the per-creator deltas sum to 81.6% of one GPU-second; `IOAccelerator` `Device Utilization %` averaged 80.6% over the same snapshots. `lastSubmittedTime` is mach absolute time in ns, checked against `mach_absolute_time()`.
- **Electron GPU process: visible.** Tagma Dev's GPU process (pid 32644, creator `Electron Helper`) has one AGX client with 2 queues. Its counter rose 818 ms in a 5.19 s window (15.8% of one GPU-second) and 1.20 s in a 14.85 s window (8.1%). Its two renderers (pids 32691, 99610, `Electron Helper (Renderer)`) and its utility processes hold no AGX client; its main process (32437) holds one with zero queues. A Chrome GPU helper (97697) holds 2 queues with a cumulative 6.45e12 ns; its counter did not move in either window. No browser page was driven.
- **Why the 2026-10-31 reading missed it.** The entry is present now, so the registry does not omit it. The creator is keyed by pid and named by the executable `Electron Helper`, which every Electron app's GPU process shares (a test run's GPU process, pid 10145, had 2 queues in the first read and was gone later). A match on the app name `Tagma` finds nothing; a match on the pid finds the entry. The earlier reading's method is not recorded, so an empty `AppUsage` at that moment cannot be excluded.
- **Attribution.** A queue belongs to its client and a client to its creator pid. On-behalf-of work was not observed: the VideoToolbox services had zero queues at sampling.
- **Limits.** WindowServer's main AGX client (15 queues) took 73.5% of one GPU-second in the 14.85 s window, more than all other processes together; OS compositing cannot be split per app. Renderers hold no client (measured), so a page's GPU work appears in its app's GPU process (inferred from Chromium's GPU-process design): no per-page share on macOS. A client's counter exists only while the client does; there is no history.
- **Cost.** Per pass: `ioreg -r -c IOUserClient -l` and `ioreg -r -c IOAccelerator -l`, 16 calls over 8 passes, 2.55 MB of text; 0.514 s wall and 0.468 s child CPU, about 58 ms CPU per pass; the Python parse about 3.5 ms per pass. No privilege: it runs as the user and lists creators of other users' processes too.
- **Method.** Parse `AGXDeviceUserClient` nodes: creator pid from `IOUserClientCreator`, sum of `accumulatedGPUTime` over `AppUsage`; two or more snapshots with a wall clock; compare with `IOAccelerator` `PerformanceStatistics`. The probe scripts are in this thread's scratch and do not outlive it.
- **Other macOS sources.**
  - `IOAccelerator` `PerformanceStatistics` (`Device Utilization %`, `Renderer`, `Tiler`, memory): measured as machine-level only; unprivileged; cheap.
  - `task_info(task, TASK_POWER_INFO_V2 = 26)`, field `gpu_energy.task_gpu_utilisation` (SDK MacOSX26.0, `mach/task_info.h`): needs a task port. Own task reads (kr=0, count 26). `task_for_pid` on the Tagma GPU process and on the Chrome GPU helper returned KERN_FAILURE (5) for this unprivileged caller, so it is unreadable for other processes. Unit not documented.
  - `proc_pid_rusage` RUSAGE_INFO_V6 (SDK `sys/resource.h`): readable for same-user pids (measured for five); no GPU field. Energy fields (`ri_energy_nj`, `ri_billed_energy`) are not GPU-specific.
  - `powermetrics --samplers gpu_power`: refused without root ("must be invoked as the superuser"). `top -stats gpu`: rejected ("invalid stat: gpu").
  - IOReport: not checked.

## Linux — documented, not measured (no Linux host)

- **Source.** DRM fdinfo: each open DRM file's `show_fdinfo` output at `/proc/<pid>/fdinfo/<fd>`. Keys: `drm-engine-<name>` (ns, busy time on this client's work), `drm-client-id` (dedupe of shared fds, "not double account"), `drm-cycles-*`, `drm-total-cycles-*`, `drm-maxfreq-*` (utilization from cycles), memory keys.
- **Versions in the docs.** The generic document is absent at tag v5.18 and present at v5.19. Driver implementations named: i915 from v5.19; Panfrost absent at v6.6, present at v6.8; Xe absent at v6.10, present at v6.12. Master also links Panthor and amdxdna. amdgpu appears only as the deprecated `drm-memory-*` alias; msm is named in none of the documents read. Engine keys for amdgpu and msm are not verified.
- **Permission.** The fdinfo directory is "readable only by the owner of the process" (man7 `proc_pid_fdinfo(5)`). Kernel `fs/proc/fd.c`, `proc_fdinfo_permission()`: `ptrace_may_access(task, PTRACE_MODE_READ_FSCREDS)`. Inferred: a same-user dumpable process can read another same-user process's fdinfo; other users need root or CAP_SYS_PTRACE.
- **Electron.** Inferred: Chromium's GPU process opens the DRM render node itself, so its own fds carry its engine time; no per-page share.
- **Cost.** One read per DRM fd per pass; not measured.
- **NVIDIA proprietary.** Not in the DRM driver list (inferred: no fdinfo engine keys). NVML `nvmlDeviceGetProcessUtilization` returns per-process utilization samples for processes with activity in the last sample window (cuda-python binding docs; the function is absent from the R470 device-query page). Privilege not settled: the R470 vGPU page requires root only for `nvmlVgpuInstanceClearAccountingPids`. A third-party post of 2026-08 claims no privilege is needed; unverified.

## Windows — documented, not measured (no Windows host)

- **Task Manager.** GPU data comes from the WDDM scheduler and memory manager (VidSch, VidMm), needs a WDDM 2.0+ driver, and shows each process's busiest engine (Microsoft DirectX blog, 2017-07-21). The post names neither PDH nor D3DKMT.
- **PDH `GPU Engine`.** Instance names carry the pid: `pid_<pid>_luid_<luid>_phys_<n>_eng_<n>_engtype_<type>`; counters `Utilization Percentage` and `Running Time`. Only third-party sources give these names (docs.rs `gpuviewer-core`, `gpui-fps`; a Zabbix forum thread). Rate counters need two collections. Not verified against a Microsoft page.
- **Permission.** No Microsoft page read states that a standard user may read `GPU Engine`. The Performance Monitor Users group page (Microsoft Learn) grants counter monitoring "locally and from remote clients" on domain controllers. Inferred: standard users read it, since Task Manager runs unelevated; unverified.
- **D3DKMT.** `D3DKMT_QUERYSTATISTICS_TYPE` (including `_PROCESS` and `_PROCESS_NODE2`) is documented as "Reserved for system use. Do not use."; the `D3DKMTQueryStatistics` page says "Reserved for system use. Do not use in your driver." Neither is an application source.
- **Electron.** `app.getAppMetrics()` gives `pid`, `type` (`GPU`), `cpu`, `memory`, `creationTime`, and no GPU field (electronjs.org docs). The pid comes from Electron, the GPU figure from PDH. Inferred: the pid attribution holds, since Chromium creates its Direct3D devices in the GPU process.
- **Cost.** Not measured. Inferred: wildcard expansion of `GPU Engine` scales with processes × engines × adapters.

## Not established

- Linux and Windows figures: no host here; a measurement needs fdinfo of an Electron GPU process on Linux and the `GPU Engine` instances of one on Windows.
- macOS: the unit of `task_gpu_utilisation`; on-behalf-of attribution under live VideoToolbox or Metal-compiler work.
- NVIDIA: privilege of the non-vGPU per-process utilization call.
