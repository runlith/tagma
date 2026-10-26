import Darwin
import Foundation

public enum HostClock {
  private static let scale: mach_timebase_info_data_t = {
    var value = mach_timebase_info_data_t()
    mach_timebase_info(&value)
    return value
  }()

  public static func ns(_ ticks: UInt64) -> UInt64 {
    let numerator = UInt64(scale.numer)
    let denominator = UInt64(scale.denom)
    return ticks / denominator * numerator + ticks % denominator * numerator / denominator
  }

  public static func ticks(_ ns: UInt64) -> UInt64 {
    let numerator = UInt64(scale.numer)
    let denominator = UInt64(scale.denom)
    return ns / numerator * denominator + ns % numerator * denominator / numerator
  }

  public static var now: UInt64 { ns(mach_absolute_time()) }
  public static func perFrame(_ rate: Double) -> Double {
    1_000_000_000 / rate * Double(scale.denom) / Double(scale.numer)
  }
}

public struct Refused: Error, CustomStringConvertible {
  public let code: String
  public let message: String
  public var description: String { "\(code): \(message)" }

  public init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }
}

func check(_ status: OSStatus, _ operation: String) throws {
  if status != noErr { throw Refused("device-failed", "\(operation): \(status)") }
}

public struct PCMFormat: Equatable {
  public let rate: Double
  public let channels: UInt32

  public init(rate: Double, channels: UInt32) throws {
    guard rate.isFinite, rate >= 8000, rate <= 192000, channels > 0, channels <= 32 else {
      throw Refused("unsupported", "PCM format must have 8000…192000 Hz and 1…32 channels")
    }
    self.rate = rate
    self.channels = channels
  }

  public var json: [String: Any] { ["rate": rate, "channels": channels] }
}
