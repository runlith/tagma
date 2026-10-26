import CoreFoundation
import Foundation

struct Request {
  let object: [String: Any]
  let type: String
  private var playback: (rate: Double, channels: UInt32)?

  init(_ object: [String: Any]) throws {
    guard let type = object["type"] as? String else { throw Refused("helper-mismatch", "Control message has no type") }
    self.object = object
    self.type = type
    let required: Set<String>
    let optional: Set<String>
    switch type {
    case "devices", "output", "quit": required = ["type"]; optional = []
    case "capture": required = ["type", "id", "source", "echoCancel"]; optional = ["device"]
    case "play": required = ["type", "id", "format"]; optional = []
    case "mark": required = ["type", "id", "mark"]; optional = []
    case "stop", "abort", "release", "clear", "mute", "unmute": required = ["type", "id"]; optional = []
    default: throw Refused("helper-mismatch", "Unknown message \(type)")
    }
    let keys = Set(object.keys)
    guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)) else {
      throw Refused("helper-mismatch", "Unexpected fields of \(type)")
    }
    if required.contains("id") { _ = try id() }
    if type == "capture" {
      guard let source = object["source"] as? String, ["mic", "system"].contains(source),
            let echo = object["echoCancel"] as? NSNumber, CFGetTypeID(echo) == CFBooleanGetTypeID(),
            object["device"] == nil || object["device"] is String else { throw Refused("helper-mismatch", "Invalid capture request") }
    }
    if type == "mark", !(object["mark"] is String) { throw Refused("helper-mismatch", "Mark must be a string") }
    if type == "play" { playback = try parseFormat() }
  }

  func id() throws -> UInt32 {
    guard let number = object["id"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue >= 1, number.doubleValue <= Double(UInt32.max), number.doubleValue.rounded() == number.doubleValue else {
      throw Refused("helper-mismatch", "Resource id must be a nonzero uint32")
    }
    return number.uint32Value
  }

  func format() throws -> PCMFormat {
    let playback = playback!
    return try PCMFormat(rate: playback.rate, channels: playback.channels)
  }

  private func parseFormat() throws -> (Double, UInt32) {
    guard let value = object["format"] as? [String: Any], Set(value.keys) == ["rate", "channels"],
          let rate = value["rate"] as? NSNumber, CFGetTypeID(rate) != CFBooleanGetTypeID(),
          rate.doubleValue >= 1, rate.doubleValue <= 384000, rate.doubleValue.rounded() == rate.doubleValue,
          let channels = value["channels"] as? NSNumber, CFGetTypeID(channels) != CFBooleanGetTypeID(),
          channels.doubleValue >= 1, channels.doubleValue <= 32, channels.doubleValue.rounded() == channels.doubleValue else {
      throw Refused("helper-mismatch", "Invalid PCM format")
    }
    return (rate.doubleValue, channels.uint32Value)
  }
}

final class Failures {
  private let lock = NSLock()
  private var pending: [(UInt32, Refused)] = []

  func append(_ id: UInt32, _ error: Refused) {
    lock.lock()
    pending.append((id, error))
    lock.unlock()
  }

  func take() -> [(UInt32, Refused)] {
    lock.lock()
    defer { lock.unlock() }
    let found = pending
    pending.removeAll(keepingCapacity: true)
    return found
  }
}
