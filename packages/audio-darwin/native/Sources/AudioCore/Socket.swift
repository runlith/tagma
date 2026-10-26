import Darwin
import Foundation

public enum Incoming {
  case control([String: Any])
  case audio(UInt32, Data)
}

public final class Channel {
  private let fd: Int32
  private let lock = NSLock()
  private let state = NSLock()
  private var input = Data()
  private var closed = false
  private var closing = false
  private var remoteEnded = false
  public var eof: Bool {
    state.lock()
    defer { state.unlock() }
    return remoteEnded
  }

  public init(path: String) throws {
    guard path.utf8.count < 104 else { throw Refused("helper-mismatch", "Socket path exceeds 103 bytes") }
    fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw Refused("device-failed", "socket: \(errno)") }
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &addr.sun_path) { bytes in
      bytes.copyBytes(from: Array(path.utf8) + [0])
    }
    let status = withUnsafePointer(to: &addr) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    if status != 0 { Darwin.close(fd); throw Refused("device-failed", "connect: \(errno)") }
    var yes: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
    var budget: Int32 = 8192
    setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &budget, socklen_t(MemoryLayout<Int32>.size))
    guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { Darwin.close(fd); throw Refused("device-failed", "fcntl: \(errno)") }
  }

  deinit { close() }

  public func close() {
    state.lock()
    if !closed && !closing { closing = true; shutdown(fd, SHUT_RDWR) }
    state.unlock()
    lock.lock()
    state.lock()
    if !closed { closed = true; Darwin.close(fd) }
    state.unlock()
    lock.unlock()
  }

  public func receive() throws -> [Incoming] {
    var poller = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
    let result = poll(&poller, 1, 10)
    if result < 0 && errno != EINTR { throw Refused("device-failed", "Socket poll: \(errno)") }
    if result <= 0 { return [] }
    var bytes = [UInt8](repeating: 0, count: 16384)
    state.lock()
    if closed || closing { state.unlock(); throw Refused("device-failed", "Socket is closed") }
    let count = recv(fd, &bytes, bytes.count, 0)
    let failure = errno
    state.unlock()
    if count == 0 { markEOF(); return [] }
    if count < 0 {
      if eof || failure == EAGAIN || failure == EINTR { return [] }
      if failure == ECONNRESET { markEOF(); return [] }
      throw Refused("device-failed", "Socket read: \(failure)")
    }
    input.append(contentsOf: bytes.prefix(count))
    var frames: [Incoming] = []
    while input.count >= 4 {
      let length = input.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self)) }
      guard length >= 1, length <= 1_048_576 else { throw Refused("helper-mismatch", "Invalid frame length") }
      guard input.count >= Int(length) + 4 else { break }
      let frame = Data(input.prefix(Int(length) + 4))
      input.removeFirst(Int(length) + 4)
      if frame[4] == 0 {
        guard let object = try JSONSerialization.jsonObject(with: frame.subdata(in: 5..<frame.count)) as? [String: Any] else {
          throw Refused("helper-mismatch", "Control frame is not an object")
        }
        frames.append(.control(object))
      } else if frame[4] == 1 {
        guard frame.count >= 9 else { throw Refused("helper-mismatch", "Audio frame has no resource id") }
        let id = frame.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: 5, as: UInt32.self)) }
        frames.append(.audio(id, frame.subdata(in: 9..<frame.count)))
      } else { throw Refused("helper-mismatch", "Unknown frame kind") }
    }
    return frames
  }

  public func control(_ object: [String: Any]) throws {
    let body = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try send(kind: 0, body: body)
  }

  public func audio(id: UInt32, at: UInt64, pcm: Data) throws {
    var body = Data()
    var resource = id.littleEndian
    var time = at.littleEndian
    withUnsafeBytes(of: &resource) { body.append(contentsOf: $0) }
    withUnsafeBytes(of: &time) { body.append(contentsOf: $0) }
    body.append(pcm)
    try send(kind: 1, body: body)
  }

  private func markEOF() {
    state.lock()
    remoteEnded = true
    state.unlock()
  }

  private func send(kind: UInt8, body: Data) throws {
    var length = UInt32(body.count + 1).littleEndian
    var frame = Data()
    withUnsafeBytes(of: &length) { frame.append(contentsOf: $0) }
    frame.append(kind)
    frame.append(body)
    lock.lock()
    defer { lock.unlock() }
    var offset = 0
    while offset < frame.count {
      state.lock()
      if closed || closing { state.unlock(); throw Refused("device-failed", "Socket is closed") }
      let sent = frame.withUnsafeBytes { Darwin.send(fd, $0.baseAddress!.advanced(by: offset), frame.count - offset, 0) }
      let failure = errno
      state.unlock()
      if sent > 0 { offset += sent; continue }
      if sent < 0 && failure == EINTR { continue }
      if sent < 0 && failure == EAGAIN {
        var poller = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        _ = poll(&poller, 1, -1)
        continue
      }
      if failure == EPIPE || failure == ECONNRESET { markEOF() }
      state.lock()
      closed = true
      shutdown(fd, SHUT_RDWR)
      Darwin.close(fd)
      state.unlock()
      throw Refused("device-failed", "Socket writer stopped: \(failure)")
    }
  }
}
