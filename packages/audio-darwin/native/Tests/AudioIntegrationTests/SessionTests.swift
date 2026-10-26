import AudioCore
import Darwin
import Foundation
import XCTest

final class SessionTests: XCTestCase {
  func testLivePlayerFailureKeepsOtherResourcesAndQuitRestoresMute() throws {
    let peer = try Peer()
    defer { peer.close() }
    XCTAssertEqual(try peer.control()["type"] as? String, "hello")
    try peer.send(["type": "mute", "id": 2])
    XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    try peer.send(["type": "play", "id": 5, "format": ["rate": 4000, "channels": 1]])
    let unsupported = try peer.control()
    XCTAssertEqual(unsupported["type"] as? String, "refused")
    XCTAssertEqual(unsupported["code"] as? String, "unsupported")
    XCTAssertEqual(unsupported["id"] as? Int, 5)
    try peer.send(["type": "play", "id": 1, "format": ["rate": 16000, "channels": 1]])
    XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    try peer.audio(1, Data([0]))
    let failed = try peer.control()
    XCTAssertEqual(failed["type"] as? String, "end")
    XCTAssertEqual(failed["reason"] as? String, "failed")
    XCTAssertEqual(failed["id"] as? Int, 1)
    for type in ["stop", "abort", "release", "unmute"] { try peer.send(["type": type, "id": 99]) }
    for (id, mode, reason) in [(3, "stop", "drained"), (4, "abort", "aborted")] {
      try peer.send(["type": "capture", "id": id, "source": "mic", "device": "synthetic", "echoCancel": false])
      XCTAssertEqual(try peer.control()["type"] as? String, "ready")
      try peer.send(["type": mode, "id": id])
      let ended = try peer.control()
      XCTAssertEqual(ended["type"] as? String, "end")
      XCTAssertEqual(ended["reason"] as? String, reason)
      try peer.send(["type": "stop", "id": id])
    }
    try peer.send(["type": "devices"])
    XCTAssertEqual(try peer.control()["type"] as? String, "devices")
    try peer.send(["type": "play", "id": 1, "format": ["rate": 16000, "channels": 1]])
    let reused = try peer.control()
    XCTAssertEqual(reused["type"] as? String, "refused")
    XCTAssertEqual(reused["code"] as? String, "helper-mismatch")
    XCTAssertNil(reused["id"])
    try peer.send(["type": "quit"])
    try peer.join()
    XCTAssertFalse(peer.device.muted)
  }

  func testMuteIsRecordedWhileHeldAndTheRecordGoesWithTheRestoredSound() throws {
    let peer = try Peer()
    defer { peer.close() }
    _ = try peer.control()
    XCTAssertEqual(peer.records, [])
    try peer.send(["type": "mute", "id": 1])
    XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    XCTAssertEqual(peer.records.count, 1)
    try peer.send(["type": "unmute", "id": 1])
    XCTAssertEqual(try peer.control()["type"] as? String, "end")
    XCTAssertEqual(peer.records, [])
    try peer.send(["type": "mute", "id": 2])
    XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    XCTAssertEqual(peer.records.count, 1)
    peer.disconnect()
    try peer.join()
    XCTAssertEqual(peer.records, [])
    XCTAssertFalse(peer.device.muted)
  }

  func testEOFRetiresHeldCapturesPlayersAndOverlappingMute() throws {
    let peer = try Peer()
    defer { peer.close() }
    _ = try peer.control()
    for id in [1, 2] {
      try peer.send(["type": "mute", "id": id])
      XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    }
    try peer.send(["type": "capture", "id": 3, "source": "mic", "device": "synthetic", "echoCancel": true])
    XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    try peer.send(["type": "play", "id": 4, "format": ["rate": 16000, "channels": 1]])
    XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    try peer.audio(4, Data(repeating: 0, count: 3200))
    peer.disconnect()
    try peer.join()
    XCTAssertFalse(peer.device.muted)
  }

  func testAReaderStallWithinTheCaptureWindowLosesNoAudio() throws {
    let peer = try Peer()
    defer { peer.close() }
    _ = try peer.control()
    try peer.send(["type": "capture", "id": 1, "source": "mic", "device": "synthetic", "echoCancel": false])
    XCTAssertEqual(try peer.control()["type"] as? String, "ready")
    let ready = Date()
    Thread.sleep(forTimeInterval: 2.5)
    let captured = Date().timeIntervalSince(ready)
    try peer.send(["type": "stop", "id": 1])
    var gaps: [[String: Any]] = []
    var ended: [String: Any]?
    while ended == nil {
      let message = try peer.control()
      if message["type"] as? String == "gap" { gaps.append(message) }
      if message["type"] as? String == "end" { ended = message }
    }
    XCTAssertEqual(gaps.count, 0, "\(gaps)")
    XCTAssertEqual(ended?["reason"] as? String, "drained")
    XCTAssertGreaterThanOrEqual(peer.heardBytes, Int((captured - 0.1) * 16000 * 2))
  }
}

private final class Peer {
  let device = MemoryMute()
  private let directory: String
  var records: [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: directory + "/mute")) ?? []).filter { $0.hasSuffix(".json") }
  }
  private var socket: Int32 = -1
  private(set) var heardBytes = 0
  private let channel: Channel
  private let ended = DispatchSemaphore(value: 0)
  private var failure: Error?
  private var joined = false

  init() throws {
    directory = "/tmp/audio-test-\(UUID().uuidString.prefix(8))"
    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    let listener = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    defer { Darwin.close(listener) }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let path = directory + "/s"
    withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: Array(path.utf8) + [0]) }
    let bound = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard bound == 0, listen(listener, 1) == 0 else { throw Refused("device-failed", "Test socket bind failed") }
    channel = try Channel(path: path)
    socket = accept(listener, nil, nil)
    guard socket >= 0 else { throw Refused("device-failed", "Test socket accept failed") }
    let session = Session(channel, try Output(synthetic: true), Mute(device, journal: MuteJournal(directory: directory + "/mute")), synthetic: true)
    Thread.detachNewThread { [self] in
      do { try session.run(token: "test") } catch { failure = error }
      ended.signal()
    }
  }

  func send(_ message: [String: Any]) throws {
    var body = Data([0])
    body.append(try JSONSerialization.data(withJSONObject: message))
    try frame(body)
  }

  func audio(_ id: UInt32, _ pcm: Data) throws {
    var body = Data([1])
    var id = id.littleEndian
    withUnsafeBytes(of: &id) { body.append(contentsOf: $0) }
    body.append(pcm)
    try frame(body)
  }

  func control() throws -> [String: Any] {
    while true {
      let prefix = try read(4)
      let length = prefix.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self)) }
      let body = try read(Int(length))
      if body.first == 0 { return try JSONSerialization.jsonObject(with: body.dropFirst()) as! [String: Any] }
      heardBytes += body.count - 13
    }
  }

  func disconnect() {
    if socket >= 0 { shutdown(socket, SHUT_RDWR); Darwin.close(socket); socket = -1 }
  }

  func join() throws {
    if !joined {
      guard ended.wait(timeout: .now() + 2) == .success else { throw Refused("device-failed", "Session did not end") }
      joined = true
    }
    if let failure { throw failure }
  }

  func close() {
    disconnect()
    do { try join() } catch { XCTFail(String(describing: error)); channel.close() }
    do { try FileManager.default.removeItem(atPath: directory) } catch { XCTFail(String(describing: error)) }
  }

  private func frame(_ body: Data) throws {
    var prefix = UInt32(body.count).littleEndian
    var frame = Data()
    withUnsafeBytes(of: &prefix) { frame.append(contentsOf: $0) }
    frame.append(body)
    var offset = 0
    while offset < frame.count {
      let count = frame.withUnsafeBytes { Darwin.send(socket, $0.baseAddress!.advanced(by: offset), frame.count - offset, 0) }
      guard count > 0 else { throw Refused("device-failed", "Test socket write failed") }
      offset += count
    }
  }

  private func read(_ count: Int) throws -> Data {
    var data = Data(count: count)
    var offset = 0
    while offset < count {
      var waiter = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard poll(&waiter, 1, 2000) > 0 else { throw Refused("device-failed", "Timed out reading helper") }
      let read = data.withUnsafeMutableBytes { Darwin.recv(socket, $0.baseAddress!.advanced(by: offset), count - offset, 0) }
      guard read > 0 else { throw Refused("device-failed", "Helper socket ended") }
      offset += read
    }
    return data
  }
}
