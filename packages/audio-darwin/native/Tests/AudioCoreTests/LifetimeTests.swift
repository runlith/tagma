import AudioCore
import AVFoundation
import Realtime
import XCTest

final class LifetimeTests: XCTestCase {
  func testProducerAndConsumerPreserveEveryFrameAcrossWraps() throws {
    var result = Data()
    let consumer = try Consumer(rate: 16000, channels: 1, budgetFrames: 256) { event in
      if case .audio(_, let bytes) = event { result.append(bytes) }
      if case .gap = event { XCTFail("Unexpected overflow") }
    }
    let available = DispatchSemaphore(value: 0)
    let consumed = DispatchSemaphore(value: 4)
    let complete = DispatchSemaphore(value: 0)
    Thread.detachNewThread {
      let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 127)!
      buffer.frameLength = 127
      for block in 0..<16 {
        consumed.wait()
        for frame in 0..<127 { buffer.floatChannelData![0][frame] = Float(block * 127 + frame) / 32768 }
        rt_ring_write(consumer.ring, buffer.audioBufferList, 127, HostClock.ticks(1_000_000_000 + UInt64(block * 127) * 62500))
        available.signal()
      }
      complete.signal()
    }
    for _ in 0..<16 {
      XCTAssertEqual(available.wait(timeout: .now() + 1), .success)
      try consumer.drain()
      consumed.signal()
    }
    XCTAssertEqual(complete.wait(timeout: .now() + 1), .success)
    try consumer.finish()
    XCTAssertEqual(result.count, 16 * 127 * 2)
    result.withUnsafeBytes { bytes in
      for frame in 0..<16 * 127 {
        XCTAssertEqual(bytes.loadUnaligned(fromByteOffset: frame * 2, as: Int16.self), Int16(frame), accuracy: 1)
      }
    }
  }

  func testANewHelperRestoresTheSoundADeadHolderLeftMuted() throws {
    for original in [false, true] {
      let directory = temporary()
      defer { try? FileManager.default.removeItem(atPath: directory) }
      let device = MemoryMute(original)
      let holder = try sleeper()
      try Mute(device, journal: MuteJournal(directory: directory, pid: holder.processIdentifier)).acquire(1)
      XCTAssertTrue(device.muted)

      MuteJournal.recover(directory: directory, device: device)
      XCTAssertTrue(device.muted, "a live holder's record is not a leftover")
      XCTAssertEqual(records(directory).count, 1)

      holder.terminate()
      holder.waitUntilExit()
      device.write(!original)
      MuteJournal.recover(directory: directory, device: device)
      XCTAssertEqual(device.muted, original)
      XCTAssertEqual(records(directory), [])
    }
  }

  func testAReusedPidIsNotAHolderAndAMissingDeviceKeepsItsRecord() throws {
    let directory = temporary()
    defer { try? FileManager.default.removeItem(atPath: directory) }
    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
    let device = MemoryMute(true)
    try record(directory, "reused", device: "synthetic", original: false, holder: (Int(getpid()), 1))
    try record(directory, "gone", device: "elsewhere", original: false, holder: nil)
    MuteJournal.recover(directory: directory, device: device)
    XCTAssertFalse(device.muted)
    XCTAssertEqual(records(directory), ["gone.json"])
  }

  func testTwoHelpersOnOneDeviceRestoreTheOriginalOnceWhenTheLastLetsGo() throws {
    for original in [false, true] {
      let directory = temporary()
      defer { try? FileManager.default.removeItem(atPath: directory) }
      let device = MemoryMute(original)
      let other = try sleeper()
      defer { other.terminate() }
      let first = Mute(device, journal: MuteJournal(directory: directory, pid: other.processIdentifier))
      let second = Mute(device, journal: MuteJournal(directory: directory))
      try first.acquire(1)
      try second.acquire(1)
      try first.release(1)
      XCTAssertTrue(device.muted)
      XCTAssertEqual(records(directory).count, 1)
      try second.release(1)
      XCTAssertEqual(device.muted, original)
      XCTAssertEqual(records(directory), [])
    }
  }

  func testMuteIsRefusedAndTheSoundUntouchedWhenTheRecordCannotBeWritten() throws {
    let blocker = temporary()
    defer { try? FileManager.default.removeItem(atPath: blocker) }
    try Data().write(to: URL(fileURLWithPath: blocker))
    let device = MemoryMute(false)
    XCTAssertThrowsError(try Mute(device, journal: MuteJournal(directory: blocker + "/audio-mute")).acquire(1))
    XCTAssertFalse(device.muted)
  }

  private func temporary() -> String { NSTemporaryDirectory() + UUID().uuidString }

  private func records(_ directory: String) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: directory)) ?? []).filter { $0.hasSuffix(".json") }.sorted()
  }

  private func sleeper() throws -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sleep")
    process.arguments = ["30"]
    try process.run()
    return process
  }

  private func record(_ directory: String, _ name: String, device: String, original: Bool, holder: (Int, Int)?) throws {
    let holders = holder.map { [["pid": $0.0, "started": $0.1]] } ?? []
    let object: [String: Any] = ["device": device, "original": original, "holders": holders]
    try JSONSerialization.data(withJSONObject: object).write(to: URL(fileURLWithPath: "\(directory)/\(name).json"))
  }

  func testMuteHoldersRestoreExactlyTheOriginalStateOnReleaseAndDisconnect() throws {
    for original in [false, true] {
      let device = MemoryMute(original)
      let mute = Mute(device, journal: MuteJournal(directory: NSTemporaryDirectory() + UUID().uuidString))
      try mute.acquire(1)
      try mute.acquire(2)
      try mute.release(1)
      XCTAssertTrue(device.muted)
      try mute.release(2)
      XCTAssertEqual(device.muted, original)
      try mute.acquire(3)
      try mute.acquire(4)
      try mute.restore()
      XCTAssertEqual(device.muted, original)
    }
  }
}
