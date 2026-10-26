import Darwin
import Foundation

struct RecordRemovalFailed: Error, CustomStringConvertible {
  let reason: String
  var description: String { "Output sound is restored; its mute record was not removed: \(reason)" }
}

public final class MuteJournal {
  struct Holder: Equatable {
    let pid: Int32
    let started: Int
  }

  struct Record {
    let device: String
    let original: Bool
    let holders: [Holder]
  }

  private let directory: String
  private let me: Holder?

  public init(directory: String, pid: Int32 = getpid()) {
    self.directory = directory
    me = Self.processStart(pid).map { Holder(pid: pid, started: $0) }
  }

  public static func processStart(_ pid: Int32) -> Int? {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&name, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
    let time = info.kp_proc.p_starttime
    return Int(time.tv_sec) * 1_000_000 + Int(time.tv_usec)
  }

  func join(device: String, current: Bool) throws -> Bool {
    guard let me else { throw Refused("device-failed", "Helper start time is unreadable") }
    return try Self.locked(directory, create: true) {
      let file = Self.file(directory, device)
      let known = try Self.load(file)
      let original = known?.original ?? current
      let holders = (known?.holders ?? []).filter { $0 != me && Self.alive($0) } + [me]
      try Self.save(Record(device: device, original: original, holders: holders), file)
      return original
    }
  }

  func leave(device: String, original: Bool, apply: (Bool) throws -> Void) throws {
    guard let me else { throw Refused("device-failed", "Helper start time is unreadable") }
    try Self.locked(directory, create: false) {
      let file = Self.file(directory, device)
      let known = try Self.load(file)
      let others = (known?.holders ?? []).filter { $0 != me && Self.alive($0) }
      if !others.isEmpty, let known {
        try Self.save(Record(device: device, original: known.original, holders: others), file)
        return
      }
      try apply(known?.original ?? original)
      do { try Self.remove(file) } catch { throw RecordRemovalFailed(reason: String(describing: error)) }
    }
  }

  public static func recover(directory: String, device: MuteDevice) {
    guard FileManager.default.fileExists(atPath: directory) else { return }
    do {
      try locked(directory, create: false) {
        for name in try FileManager.default.contentsOfDirectory(atPath: directory).sorted() where name.hasSuffix(".json") {
          let file = "\(directory)/\(name)"
          do {
            guard let record = try load(file) else {
              try remove(file)
              continue
            }
            let living = record.holders.filter(alive)
            if !living.isEmpty {
              if living.count != record.holders.count { try save(Record(device: record.device, original: record.original, holders: living), file) }
              continue
            }
            try device.restore(uid: record.device, muted: record.original)
            try remove(file)
          } catch { FileHandle.standardError.write(Data("Mute recovery of \(name): \(error)\n".utf8)) }
        }
      }
    } catch { FileHandle.standardError.write(Data("Mute recovery: \(error)\n".utf8)) }
  }

  private static func alive(_ holder: Holder) -> Bool {
    processStart(holder.pid) == holder.started
  }

  private static func file(_ directory: String, _ device: String) -> String {
    "\(directory)/\(device.utf8.map { String(format: "%02x", $0) }.joined()).json"
  }

  private static func remove(_ file: String) throws {
    try FileManager.default.removeItem(atPath: file)
  }

  private static func load(_ file: String) throws -> Record? {
    guard FileManager.default.fileExists(atPath: file) else { return nil }
    let data: Data
    do { data = try Data(contentsOf: URL(fileURLWithPath: file)) } catch {
      throw Refused("device-failed", "Mute record is unreadable: \(error)")
    }
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let device = object["device"] as? String, let original = object["original"] as? Bool,
      let list = object["holders"] as? [[String: Any]]
    else { return nil }
    var holders: [Holder] = []
    for item in list {
      guard let pid = item["pid"] as? Int, let started = item["started"] as? Int else { return nil }
      holders.append(Holder(pid: Int32(truncatingIfNeeded: pid), started: started))
    }
    return Record(device: device, original: original, holders: holders)
  }

  private static func save(_ record: Record, _ file: String) throws {
    let object: [String: Any] = [
      "device": record.device,
      "original": record.original,
      "holders": record.holders.map { ["pid": Int($0.pid), "started": $0.started] },
    ]
    do { try JSONSerialization.data(withJSONObject: object).write(to: URL(fileURLWithPath: file), options: .atomic) } catch {
      throw Refused("device-failed", "Mute record was not written: \(error)")
    }
  }

  private static func locked<T>(_ directory: String, create: Bool, _ body: () throws -> T) throws -> T {
    if create {
      do { try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) } catch {
        throw Refused("device-failed", "Mute record directory was not created: \(error)")
      }
    }
    let descriptor = Darwin.open("\(directory)/lock", O_RDWR | O_CREAT, 0o600)
    guard descriptor >= 0 else { throw Refused("device-failed", "Mute record lock was not opened: errno \(errno)") }
    defer { Darwin.close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { throw Refused("device-failed", "Mute record lock was not taken: errno \(errno)") }
    return try body()
  }
}
