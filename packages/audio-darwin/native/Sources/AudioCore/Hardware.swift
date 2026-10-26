import AVFoundation
import CoreAudio
import Foundation

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func property<T>(_ device: AudioObjectID, _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, initial: T) throws -> T {
  var location = address(selector, scope)
  var result = initial
  var size = UInt32(MemoryLayout<T>.size)
  try withUnsafeMutablePointer(to: &result) { pointer in
    try check(AudioObjectGetPropertyData(device, &location, 0, nil, &size, pointer), "Read audio property \(selector)")
  }
  return result
}

public struct DeviceLoss {
  public let at: UInt64
  public let cause: String

  public init(at: UInt64 = HostClock.now, cause: String) { self.at = at; self.cause = cause }
}

struct QuiescenceFailed: Error {
  let message: String
}

public enum Hardware {
  public static func defaultDevice(input: Bool) throws -> AudioObjectID {
    let device: AudioObjectID = try property(AudioObjectID(kAudioObjectSystemObject), input ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice, initial: 0)
    guard device != kAudioObjectUnknown else { throw Refused("device-missing", "No default audio device") }
    return device
  }

  public static func input(_ uid: String?) throws -> AudioObjectID {
    guard let uid else { return try untouchedDefault() }
    guard let found = try inputs().first(where: { $0.uid == uid }) else { throw Refused("device-missing", "Input device \(uid) is absent") }
    return found.object
  }

  private static func untouchedDefault() throws -> AudioObjectID {
    let device = try defaultDevice(input: true)
    guard try bluetooth(device) else { return device }
    for candidate in try inputs() where try property(candidate.object, kAudioDevicePropertyTransportType, initial: UInt32(0)) == kAudioDeviceTransportTypeBuiltIn {
      return candidate.object
    }
    return device
  }

  private static func bluetooth(_ device: AudioObjectID) throws -> Bool {
    let transport: UInt32 = try property(device, kAudioDevicePropertyTransportType, initial: 0)
    return transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE
  }

  public struct Input {
    public let object: AudioObjectID
    public let uid: String
    public let label: String
  }

  public static func inputs() throws -> [Input] {
    var location = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    try check(AudioObjectGetPropertyDataSize(system, &location, 0, nil, &size), "List audio devices")
    var devices = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    try check(AudioObjectGetPropertyData(system, &location, 0, nil, &size, &devices), "List audio devices")
    var result: [Input] = []
    for device in devices {
      let alive: UInt32 = try property(device, kAudioDevicePropertyDeviceIsAlive, initial: 0)
      if alive == 0 { continue }
      if try inputChannels(device) == 0 { continue }
      let uid: CFString = try property(device, kAudioDevicePropertyDeviceUID, initial: "" as CFString)
      let label: CFString = try property(device, kAudioObjectPropertyName, initial: "" as CFString)
      result.append(Input(object: device, uid: uid as String, label: label as String))
    }
    return result.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
  }

  static func inputChannels(_ device: AudioObjectID) throws -> UInt32 {
    var location = address(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput)
    while true {
      var bytes: UInt32 = 0
      try check(AudioObjectGetPropertyDataSize(device, &location, 0, nil, &bytes), "Read input channels")
      let storage = UnsafeMutableRawPointer.allocate(byteCount: max(Int(bytes), MemoryLayout<AudioBufferList>.size), alignment: MemoryLayout<AudioBufferList>.alignment)
      defer { storage.deallocate() }
      let status = AudioObjectGetPropertyData(device, &location, 0, nil, &bytes, storage)
      if status == kAudioHardwareBadPropertySizeError { continue }
      try check(status, "Read input channels")
      return UnsafeMutableAudioBufferListPointer(storage.assumingMemoryBound(to: AudioBufferList.self)).reduce(0) { $0 + $1.mNumberChannels }
    }
  }

  public static var outputKind: String {
    guard let device = try? defaultDevice(input: false),
          let transport = try? property(device, kAudioDevicePropertyTransportType, initial: UInt32(0)) else { return "unknown" }
    switch transport {
    case kAudioDeviceTransportTypeHDMI, kAudioDeviceTransportTypeDisplayPort: return "speakers"
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE, kAudioDeviceTransportTypeUSB: return "headphones"
    case kAudioDeviceTransportTypeBuiltIn:
      switch try? property(device, kAudioDevicePropertyDataSource, kAudioObjectPropertyScopeOutput, initial: UInt32(0)) {
      case code("ispk"): return "speakers"
      case code("hdpn"): return "headphones"
      default: return "unknown"
      }
    default: return "unknown"
    }
  }

  private static func code(_ text: String) -> UInt32 {
    text.utf8.reduce(0) { $0 << 8 | UInt32($1) }
  }

  public static var microphonePermission: String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .denied, .restricted: return "denied"
    case .notDetermined: return "not-asked"
    @unknown default: return "unknown"
    }
  }

  public static func authorizeMicrophone() throws {
    if microphonePermission == "not-asked" {
      let wait = DispatchSemaphore(value: 0)
      AVCaptureDevice.requestAccess(for: .audio) { _ in wait.signal() }
      guard wait.wait(timeout: .now() + 60) == .success else { throw Refused("permission-denied", "Microphone permission was not answered") }
    }
    guard microphonePermission == "granted" else { throw Refused("permission-denied", "Microphone permission is denied") }
  }
}

@available(macOS 14.2, *)
public final class SystemTap {
  public private(set) var device: AudioObjectID = 0
  public private(set) var format = AudioStreamBasicDescription()
  private var tap: AudioObjectID = 0

  public init() throws {
    var location = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
    var pid = getpid()
    var process: AudioObjectID = 0
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &location, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &process), "Translate helper audio process")
    guard process != kAudioObjectUnknown else { throw Refused("device-failed", "Helper has no audio process object after output opened") }
    let description = CATapDescription()
    description.name = "Audio capture"
    description.processes = [process]
    description.isPrivate = true
    description.isExclusive = true
    description.isMixdown = true
    description.isMono = false
    description.muteBehavior = .unmuted
    description.stream = 0
    try check(AudioHardwareCreateProcessTap(description, &tap), "Create system audio tap")
    do {
      format = try property(tap, kAudioTapPropertyFormat, initial: AudioStreamBasicDescription())
      let uid: CFString = try property(tap, kAudioTapPropertyUID, initial: "" as CFString)
      let aggregate: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Audio capture",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceSubDeviceListKey: [] as CFArray,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
      ]
      try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "Create capture aggregate")
      try attach(uid)
    } catch {
      if device != 0 { AudioHardwareDestroyAggregateDevice(device); device = 0 }
      AudioHardwareDestroyProcessTap(tap)
      tap = 0
      throw error
    }
  }

  private func attach(_ uid: CFString) throws {
    let changed = DispatchSemaphore(value: 0)
    let queue = DispatchQueue(label: "audio.tap-input")
    let listener: AudioObjectPropertyListenerBlock = { _, _ in changed.signal() }
    var input = address(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput)
    try check(AudioObjectAddPropertyListenerBlock(device, &input, queue, listener), "Observe capture aggregate")
    let published: Result<Void, Error>
    do {
      var tapAddress = address(kAudioAggregateDevicePropertyTapList)
      try withUnsafePointer(to: [uid] as CFArray) { pointer in
        try check(AudioObjectSetPropertyData(device, &tapAddress, 0, nil, UInt32(MemoryLayout<CFArray>.size), pointer), "Attach system tap")
      }
      let deadline = DispatchTime.now() + .seconds(2)
      while try Hardware.inputChannels(device) != format.mChannelsPerFrame {
        guard changed.wait(timeout: deadline) == .success else { throw Refused("device-failed", "System audio device did not publish its input") }
      }
      published = .success(())
    } catch { published = .failure(error) }
    let removed = AudioObjectRemovePropertyListenerBlock(device, &input, queue, listener)
    queue.sync {}
    try published.get()
    try check(removed, "Stop observing capture aggregate")
  }

  deinit {
    if device != 0 { AudioHardwareDestroyAggregateDevice(device) }
    if tap != 0 { AudioHardwareDestroyProcessTap(tap) }
  }
}
