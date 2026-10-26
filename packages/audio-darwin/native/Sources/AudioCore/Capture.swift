import CoreAudio
import Foundation
import Realtime

public final class Capture {
  private let consumer: Consumer
  private let emit: (CaptureEvent) -> Void
  private let condition = NSCondition()
  private let finished = DispatchSemaphore(value: 0)
  private var ending: Bool?
  private var producerStopped = true
  private var started = false
  private var device: AudioObjectID?
  private var io: AudioDeviceIOProcID?
  private var voice: OpaquePointer?
  private var retainedTap: AnyObject?
  private var synthetic: SyntheticInput?
  private var listener: AudioObjectPropertyListenerBlock?
  private var loss: DeviceLoss?
  private var failure: Refused?
  private var observed: [AudioObjectPropertySelector] = []
  private var quarantined = false
  private let listenerQueue = DispatchQueue(label: "audio.device-change")
  public var failed: Bool {
    condition.lock()
    defer { condition.unlock() }
    return failure != nil
  }

  public convenience init(device: AudioObjectID, emit: @escaping (CaptureEvent) -> Void) throws {
    let format: AudioStreamBasicDescription = try property(device, kAudioDevicePropertyStreamFormat, kAudioDevicePropertyScopeInput, initial: AudioStreamBasicDescription())
    try self.init(device: device, format: format, tap: nil, emit: emit)
  }

  @available(macOS 14.2, *)
  public convenience init(tap: SystemTap, emit: @escaping (CaptureEvent) -> Void) throws {
    try self.init(device: tap.device, format: tap.format, tap: tap, emit: emit)
  }

  private init(device: AudioObjectID, format: AudioStreamBasicDescription, tap: AnyObject?, emit: @escaping (CaptureEvent) -> Void) throws {
    let planar = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
    let stride = (planar ? 1 : format.mChannelsPerFrame) * 4
    guard format.mFormatID == kAudioFormatLinearPCM,
          format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          format.mFormatFlags & kAudioFormatFlagIsPacked != 0,
          format.mFormatFlags & kAudioFormatFlagIsBigEndian == 0,
          format.mBitsPerChannel == 32, format.mFramesPerPacket == 1,
          format.mBytesPerFrame == stride, format.mBytesPerPacket == stride else {
      throw Refused("unsupported", "Capture device must expose packed native-endian float32 PCM")
    }
    self.consumer = try Consumer(rate: format.mSampleRate, channels: format.mChannelsPerFrame, emit: emit)
    self.emit = emit
    self.device = device
    self.retainedTap = tap
    var proc: AudioDeviceIOProcID?
    try check(AudioDeviceCreateIOProcID(device, rt_ring_ioproc, UnsafeMutableRawPointer(consumer.ring), &proc), "Create capture IO procedure")
    self.io = proc
  }

  public init(voice: OpaquePointer, emit: @escaping (CaptureEvent) -> Void) throws {
    self.consumer = try Consumer(rate: 48000, channels: 1, emit: emit)
    self.emit = emit
    self.voice = voice
  }

  public init(syntheticGap: Bool, emit: @escaping (CaptureEvent) -> Void) throws {
    self.consumer = try Consumer(rate: 48000, channels: 2, emit: emit)
    self.emit = emit
    self.synthetic = SyntheticInput(consumer.ring, overflow: syntheticGap)
  }

  public func start(ready: () throws -> Void = {}) throws {
    guard !started else { return }
    if let device, let io {
      let listener: AudioObjectPropertyListenerBlock = { [weak self] count, properties in
        guard let self else { return }
        let lost = (0..<Int(count)).contains { properties[$0].mSelector == kAudioDevicePropertyDeviceIsAlive }
        self.recordLoss(DeviceLoss(cause: lost ? "device-lost" : "device-change"), Refused("device-failed", "Input device changed"))
      }
      self.listener = listener
      for selector in [kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyStreamFormat] {
        var location = address(selector, selector == kAudioDevicePropertyStreamFormat ? kAudioDevicePropertyScopeInput : kAudioObjectPropertyScopeGlobal)
        try check(AudioObjectAddPropertyListenerBlock(device, &location, listenerQueue, listener), "Observe input device")
        observed.append(selector)
      }
      try check(AudioDeviceStart(device, io), "Start capture device")
    }
    if let voice, rt_voice_attach(voice, consumer.ring) == 0 { throw Refused("unsupported", "All voice input slots are occupied") }
    synthetic?.start()
    try ready()
    started = true
    let watchedVoice = voice
    let voiceFaults = watchedVoice.map(rt_voice_failures)
    Thread.detachNewThread { [self] in
      defer { finished.signal() }
      var notified = false
      while true {
        condition.lock()
        let end = ending
        let lost = loss
        let error = failure
        let stopped = producerStopped
        condition.unlock()
        if let end {
          if !stopped { break }
          if let lost { consumer.interrupt(at: lost.at, cause: lost.cause) }
          else if end {
            do { try consumer.finish() }
            catch {
              let failure = error as? Refused ?? Refused("device-failed", String(describing: error))
              recordLoss(DeviceLoss(cause: "device-lost"), failure)
              consumer.interrupt(at: HostClock.now, cause: "device-lost")
            }
          }
          break
        }
        if let error, !notified { notified = true; emit(.failed(error)) }
        if error == nil {
          if let watchedVoice, rt_voice_failures(watchedVoice) != voiceFaults {
            recordLoss(DeviceLoss(cause: "device-lost"), Refused("device-failed", "Voice input stopped rendering"))
          } else if rt_ring_faulted(consumer.ring) != 0 {
            recordLoss(DeviceLoss(cause: "device-change"), Refused("device-failed", "Input layout changed"))
          } else {
            do { try consumer.drain() }
            catch { recordLoss(DeviceLoss(cause: "device-lost"), error as? Refused ?? Refused("device-failed", String(describing: error))) }
          }
        }
        condition.lock()
        if ending == nil { _ = condition.wait(until: Date(timeIntervalSinceNow: 0.003)) }
        condition.unlock()
      }
    }
  }

  public func stop(drain: Bool, loss: DeviceLoss? = nil) throws {
    if let loss { recordLoss(loss, Refused("device-failed", "Audio hardware changed")) }
    var cleanup: Refused?
    var quiescent = true
    if let device, let io {
      let stopped = AudioDeviceStop(device, io)
      let destroyed = AudioDeviceDestroyIOProcID(device, io)
      quiescent = stopped == noErr || destroyed == noErr || stopped == kAudioHardwareBadDeviceError || destroyed == kAudioHardwareBadDeviceError
      if stopped != noErr || destroyed != noErr {
        cleanup = Refused("device-failed", "Capture teardown: stop \(stopped), destroy \(destroyed)")
        recordLoss(DeviceLoss(cause: "device-lost"), cleanup!)
      }
      if quiescent { self.io = nil }
    }
    if let voice { rt_voice_detach(voice, consumer.ring); self.voice = nil }
    synthetic?.stop(drain: drain && !failed)
    if let device, let listener {
      for selector in observed {
        var location = address(selector, selector == kAudioDevicePropertyStreamFormat ? kAudioDevicePropertyScopeInput : kAudioObjectPropertyScopeGlobal)
        let status = AudioObjectRemovePropertyListenerBlock(device, &location, listenerQueue, listener)
        if status != noErr, cleanup == nil { cleanup = Refused("device-failed", "Remove input observer: \(status)") }
      }
      observed.removeAll()
      self.listener = nil
      listenerQueue.sync {}
    }
    if rt_ring_faulted(consumer.ring) != 0 { recordLoss(DeviceLoss(cause: "device-change"), Refused("device-failed", "Input layout changed")) }
    if let cleanup { recordLoss(DeviceLoss(cause: "device-lost"), cleanup) }
    if started {
      condition.lock()
      producerStopped = quiescent
      ending = drain
      condition.signal()
      condition.unlock()
      finished.wait()
      started = false
    }
    if !quiescent {
      if !quarantined { quarantined = true; _ = Unmanaged.passRetained(self) }
      throw QuiescenceFailed(message: "Capture producer could not be stopped; its ring is retained until helper exit")
    }
    if let cleanup { throw cleanup }
  }

  private func recordLoss(_ loss: DeviceLoss, _ failure: Refused) {
    condition.lock()
    if self.loss == nil { self.loss = loss; self.failure = failure }
    condition.signal()
    condition.unlock()
  }

  deinit {
    if let device, let io { AudioDeviceStop(device, io); AudioDeviceDestroyIOProcID(device, io) }
  }
}
