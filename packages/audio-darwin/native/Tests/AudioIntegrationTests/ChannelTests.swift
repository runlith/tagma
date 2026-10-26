import AudioCore
import Darwin
import Foundation
import XCTest

final class ChannelTests: XCTestCase {
  func testClosingInterruptsAPartialFrameWithoutWaitingForTheReader() throws {
    let directory = "/tmp/audio-wire-\(UUID().uuidString.prefix(8))"
    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer {
      do { try FileManager.default.removeItem(atPath: directory) } catch { XCTFail(String(describing: error)) }
    }
    let listener = socket(AF_UNIX, SOCK_STREAM, 0)
    defer { Darwin.close(listener) }
    var location = sockaddr_un()
    location.sun_family = sa_family_t(AF_UNIX)
    location.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let path = directory + "/s"
    withUnsafeMutableBytes(of: &location.sun_path) { $0.copyBytes(from: Array(path.utf8) + [0]) }
    let bound = withUnsafePointer(to: &location) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    XCTAssertEqual(bound, 0)
    XCTAssertEqual(listen(listener, 1), 0)
    let channel = try Channel(path: path)
    let reader = accept(listener, nil, nil)
    defer { Darwin.close(reader) }
    var budget: Int32 = 1024
    setsockopt(reader, SOL_SOCKET, SO_RCVBUF, &budget, socklen_t(MemoryLayout<Int32>.size))
    let ended = DispatchSemaphore(value: 0)
    var failed = false
    Thread.detachNewThread {
      do { try channel.control(["payload": String(repeating: "x", count: 524288)]) }
      catch { failed = true }
      ended.signal()
    }
    var prefix: UInt32 = 0
    var poller = pollfd(fd: reader, events: Int16(POLLIN), revents: 0)
    XCTAssertGreaterThan(poll(&poller, 1, 1000), 0)
    XCTAssertEqual(recv(reader, &prefix, 4, MSG_WAITALL), 4)
    XCTAssertGreaterThan(UInt32(littleEndian: prefix), 524288)
    channel.close()
    XCTAssertEqual(ended.wait(timeout: .now() + 1), .success)
    XCTAssertTrue(failed)
  }
}
