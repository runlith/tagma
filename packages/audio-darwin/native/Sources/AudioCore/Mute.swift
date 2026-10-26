import CoreAudio
import Foundation

public protocol MuteDevice: AnyObject {
  var uid: String { get }
  func read() throws -> Bool
  func write(_ muted: Bool) throws
  func restore(uid: String, muted: Bool) throws
}

public final class Mute {
  private let device: MuteDevice
  private let journal: MuteJournal
  private var holders = Set<UInt32>()
  private var original: Bool?
  private var held = ""

  public init(_ device: MuteDevice, journal: MuteJournal) {
    self.device = device
    self.journal = journal
  }

  public func acquire(_ id: UInt32) throws {
    if holders.contains(id) { throw Refused("helper-mismatch", "Duplicate mute holder") }
    if holders.isEmpty {
      let current = try device.read()
      let uid = device.uid
      let previous = try journal.join(device: uid, current: current)
      do { try device.write(true) } catch {
        do { try journal.leave(device: uid, original: previous) { try device.write($0) } }
        catch { FileHandle.standardError.write(Data("Mute record: \(error)\n".utf8)) }
        throw error
      }
      original = previous
      held = uid
    }
    holders.insert(id)
  }

  public func release(_ id: UInt32) throws {
    guard holders.contains(id) else { throw Refused("helper-mismatch", "Unknown mute holder") }
    if holders.count == 1 { try giveBack() }
    holders.remove(id)
  }

  public func restore() throws {
    try giveBack()
    holders.removeAll()
  }

  private func giveBack() throws {
    guard let original else { return }
    do { try journal.leave(device: held, original: original) { try device.write($0) } }
    catch let failure as RecordRemovalFailed {
      self.original = nil
      holders.removeAll()
      throw failure
    }
    self.original = nil
  }
}

public final class OutputMute: MuteDevice {
  private var device: AudioObjectID?

  public private(set) var uid = ""

  public init() {}

  public func read() throws -> Bool {
    let found = try Hardware.defaultDevice(input: false)
    let name: CFString = try property(found, kAudioDevicePropertyDeviceUID, initial: "" as CFString)
    var location = address(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput)
    var settable = DarwinBoolean(false)
    guard AudioObjectHasProperty(found, &location) else { throw Refused("unsupported", "Output has no mute control") }
    try check(AudioObjectIsPropertySettable(found, &location, &settable), "Read mute control")
    guard settable.boolValue else { throw Refused("unsupported", "Output mute is not settable") }
    let value: UInt32 = try property(found, kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput, initial: 0)
    device = found
    uid = name as String
    return value != 0
  }

  public func write(_ muted: Bool) throws {
    guard let device else { throw Refused("device-failed", "Mute device was not read") }
    try set(device, muted)
  }

  public func restore(uid: String, muted: Bool) throws {
    var location = address(kAudioHardwarePropertyTranslateUIDToDevice)
    var name = uid as CFString
    var found = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(
      AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &location, UInt32(MemoryLayout<CFString>.size), &name, &size, &found),
      "Find output \(uid)")
    guard found != kAudioObjectUnknown else { throw Refused("device-missing", "Output \(uid) is absent") }
    try set(found, muted)
  }

  private func set(_ device: AudioObjectID, _ muted: Bool) throws {
    var location = address(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput)
    var value: UInt32 = muted ? 1 : 0
    try check(AudioObjectSetPropertyData(device, &location, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value), "Set output mute")
  }
}

public final class MemoryMute: MuteDevice {
  public private(set) var muted: Bool
  public let uid = "synthetic"
  public init(_ muted: Bool = false) { self.muted = muted }
  public func read() -> Bool { muted }
  public func write(_ muted: Bool) { self.muted = muted }
  public func restore(uid: String, muted: Bool) throws {
    guard uid == self.uid else { throw Refused("device-missing", "Output \(uid) is absent") }
    self.muted = muted
  }
}
