import AudioToolbox
import CoreAudio
import Foundation
import Realtime

public final class Output {
  public let mixer: OpaquePointer
  public let voice: OpaquePointer
  private var unit: AudioUnit?
  private var watch: HardwareWatch?
  private var pendingLoss: DeviceLoss?
  private var unsafe = false
  private var processingVoice = false
  private let properties: [AudioUnitPropertyID] = [kAudioOutputUnitProperty_IsRunning, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitProperty_StreamFormat]
  private var echoes = Set<UInt32>()
  private var inputDevice: AudioObjectID?
  private let synthetic: Bool
  private var nullTimer: DispatchSourceTimer?
  private let nullQueue = DispatchQueue(label: "audio.null-output")

  public init(synthetic: Bool) throws {
    guard let mixer = rt_mixer_create(4096), let voice = rt_voice_create(4096) else {
      throw Refused("device-failed", "Could not allocate output graph")
    }
    self.mixer = mixer
    self.voice = voice
    self.synthetic = synthetic
  }

  deinit {
    do { try close() }
    catch { FileHandle.standardError.write(Data("Output cleanup: \(error)\n".utf8)) }
    if !unsafe { rt_voice_destroy(voice); rt_mixer_destroy(mixer) }
  }

  public func open() throws {
    if unit != nil || nullTimer != nil { return }
    if synthetic {
      let samples = UnsafeMutablePointer<Float>.allocate(capacity: 480)
      let timer = DispatchSource.makeTimerSource(queue: nullQueue)
      timer.schedule(deadline: .now(), repeating: .milliseconds(10))
      timer.setEventHandler { [mixer] in rt_mixer_render(mixer, samples, 480) }
      timer.setCancelHandler { samples.deallocate() }
      nullTimer = timer
      timer.resume()
      return
    }
    try rebuild(voiceProcessing: !echoes.isEmpty)
  }

  public func acquireEcho(_ id: UInt32, device: AudioObjectID) throws {
    if let inputDevice, inputDevice != device { throw Refused("unsupported", "Concurrent echo cancellation uses one input device") }
    inputDevice = device
    if echoes.isEmpty && !synthetic {
      do { try rebuild(voiceProcessing: true) }
      catch { inputDevice = nil; throw error }
    }
    echoes.insert(id)
  }

  public func releaseEcho(_ id: UInt32) throws {
    echoes.remove(id)
    if echoes.isEmpty {
      inputDevice = nil
      if !synthetic && unit != nil {
        do { try rebuild(voiceProcessing: false) }
        catch {
          pendingLoss = DeviceLoss(cause: "device-lost")
          try close()
          throw error
        }
      }
    }
  }

  public func takeLoss() -> DeviceLoss? {
    let hardware = watch?.take()
    let changed = rt_mixer_changes(mixer) != 0
    let found = pendingLoss ?? hardware ?? (changed ? DeviceLoss(cause: "device-change") : nil)
    pendingLoss = nil
    return found
  }

  public func close() throws {
    nullTimer?.cancel()
    nullTimer = nil
    nullQueue.sync {}
    if let unit {
      unobserve(unit)
      let stopped = AudioOutputUnitStop(unit)
      AudioUnitUninitialize(unit)
      let disposed = AudioComponentInstanceDispose(unit)
      if stopped != noErr && disposed != noErr && stopped != kAudioHardwareBadDeviceError {
        unsafe = true
        throw QuiescenceFailed(message: "Output callbacks could not be stopped; realtime storage is retained until helper exit")
      }
      self.unit = nil
      rt_voice_bind(voice, nil)
    }
  }

  private func rebuild(voiceProcessing: Bool) throws {
    let previous = unit
    var description = AudioComponentDescription(componentType: kAudioUnitType_Output,
      componentSubType: voiceProcessing ? kAudioUnitSubType_VoiceProcessingIO : kAudioUnitSubType_DefaultOutput,
      componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
    guard let component = AudioComponentFindNext(nil, &description) else { throw Refused("unsupported", "Audio output component is absent") }
    var created: AudioUnit?
    try check(AudioComponentInstanceNew(component, &created), "Create output graph")
    guard let created else { throw Refused("device-failed", "Output graph is absent") }
    var paused = false
    do {
      if let previous {
        unobserve(previous)
        try check(AudioOutputUnitStop(previous), "Pause output graph")
        paused = true
      }
      var format = AudioStreamBasicDescription(mSampleRate: 48000, mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: 4,
        mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0)
      var maximum: UInt32 = 4096
      try set(created, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0, &maximum)
      try set(created, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &format)
      var callback = AURenderCallbackStruct(inputProc: rt_mixer_output, inputProcRefCon: UnsafeMutableRawPointer(mixer))
      try set(created, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &callback)
      if voiceProcessing {
        var enabled: UInt32 = 1
        try set(created, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &enabled)
        if var inputDevice { try set(created, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 1, &inputDevice) }
        try set(created, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &format)
        var input = AURenderCallbackStruct(inputProc: rt_voice_input, inputProcRefCon: UnsafeMutableRawPointer(voice))
        try set(created, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 1, &input)
        if #available(macOS 14.0, *) {
          var ducking = AUVoiceIOOtherAudioDuckingConfiguration(mEnableAdvancedDucking: false, mDuckingLevel: .min)
          try set(created, kAUVoiceIOProperty_OtherAudioDuckingConfiguration, kAudioUnitScope_Global, 0, &ducking)
        }
        rt_voice_bind(voice, created)
      }
      try check(AudioUnitInitialize(created), "Initialize output graph")
      try check(AudioOutputUnitStart(created), "Start output graph")
      try observe(created, voiceProcessing: voiceProcessing)
      unit = created
      processingVoice = voiceProcessing
      if let previous {
        AudioUnitUninitialize(previous)
        AudioComponentInstanceDispose(previous)
      }
    } catch {
      unobserve(created)
      let stopped = AudioOutputUnitStop(created)
      AudioUnitUninitialize(created)
      let disposed = AudioComponentInstanceDispose(created)
      if stopped != noErr && disposed != noErr {
        unsafe = true
        throw QuiescenceFailed(message: "Failed output replacement could not be stopped")
      }
      if paused || previous == nil { rt_voice_bind(voice, processingVoice ? previous : nil) }
      if let previous {
        do {
          if paused { try check(AudioOutputUnitStart(previous), "Restore output graph") }
          try observe(previous, voiceProcessing: processingVoice)
        } catch {
          pendingLoss = DeviceLoss(cause: "device-lost")
          try close()
          throw error
        }
      }
      throw error
    }
  }

  private func observe(_ unit: AudioUnit, voiceProcessing: Bool) throws {
    let watch = HardwareWatch()
    self.watch = watch
    var device: AudioObjectID = 0
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(AudioUnitGetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &device, &size), "Read bound output device")
    try watch.add(device, kAudioDevicePropertyDeviceIsAlive)
    try watch.add(device, kAudioDevicePropertyStreamFormat, scope: kAudioDevicePropertyScopeOutput)
    try watch.add(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice)
    if voiceProcessing {
      size = UInt32(MemoryLayout<AudioObjectID>.size)
      try check(AudioUnitGetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 1, &device, &size), "Read bound voice input device")
      try watch.add(device, kAudioDevicePropertyDeviceIsAlive)
      try watch.add(device, kAudioDevicePropertyStreamFormat, scope: kAudioDevicePropertyScopeInput)
    }
    _ = rt_mixer_changes(mixer)
    for property in properties {
      try check(AudioUnitAddPropertyListener(unit, property, rt_unit_changed, UnsafeMutableRawPointer(mixer)), "Observe output graph")
    }
  }

  private func unobserve(_ unit: AudioUnit) {
    for property in properties {
      AudioUnitRemovePropertyListenerWithUserData(unit, property, rt_unit_changed, UnsafeMutableRawPointer(mixer))
    }
    if let failures = watch?.close(), !failures.isEmpty {
      FileHandle.standardError.write(Data("Output observer cleanup: \(failures)\n".utf8))
    }
    watch = nil
    _ = rt_mixer_changes(mixer)
  }

  private func set<T>(_ unit: AudioUnit, _ property: AudioUnitPropertyID, _ scope: AudioUnitScope, _ element: AudioUnitElement, _ value: inout T) throws {
    try withUnsafePointer(to: &value) { pointer in
      try check(AudioUnitSetProperty(unit, property, scope, element, pointer, UInt32(MemoryLayout<T>.size)), "Configure output graph \(property)")
    }
  }
}
