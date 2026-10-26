import Foundation

final class CaptureSink {
  static let windowMs = 10_000
  private static let windowBytes = windowMs * 32
  private enum Item {
    case audio(UInt64, Data)
    case gap(UInt64, UInt64?, String)
    case end(String)
  }
  private let channel: Channel
  private let failures: Failures
  private let id: UInt32
  private let condition = NSCondition()
  private var pending: [Item] = []
  private var head = 0
  private var held = 0
  private var overflow: (from: UInt64, to: UInt64)?
  private var running = false
  private var closing = false
  private var broken = false

  init(_ channel: Channel, _ failures: Failures, _ id: UInt32) {
    self.channel = channel
    self.failures = failures
    self.id = id
  }

  func emit(_ event: CaptureEvent) {
    condition.lock()
    defer { condition.unlock() }
    guard !closing, !broken else { return }
    switch event {
    case .failed(let failure): return failures.append(id, failure)
    case .audio(let at, let pcm):
      if held + pcm.count > Self.windowBytes { return lose(at, at + UInt64(pcm.count / 2) * 1_000_000_000 / 16000) }
      held += pcm.count
      settle()
      pending.append(.audio(at, pcm))
    case .gap(let from, let to?, "overflow"): return lose(from, to)
    case .gap(let from, let to, let cause):
      settle()
      pending.append(.gap(from, to, cause))
    }
    wake()
  }

  private func lose(_ from: UInt64, _ to: UInt64) {
    overflow = (min(overflow?.from ?? from, from), max(overflow?.to ?? to, to))
  }

  func end(_ reason: String) {
    condition.lock()
    defer { condition.unlock() }
    guard !closing else { return }
    closing = true
    if broken { return }
    settle()
    pending.append(.end(reason))
    wake()
  }

  func abandon() {
    condition.lock()
    closing = true
    pending.removeAll()
    head = 0
    overflow = nil
    condition.signal()
    condition.unlock()
  }

  private func settle() {
    guard let overflow else { return }
    pending.append(.gap(overflow.from, overflow.to, "overflow"))
    self.overflow = nil
  }

  private func wake() {
    if running { return condition.signal() }
    running = true
    Thread.detachNewThread { [self] in write() }
  }

  private func write() {
    while let item = next() {
      do {
        switch item {
        case .audio(let at, let pcm): try channel.audio(id: id, at: at, pcm: pcm)
        case .gap(let from, let to, let cause):
          var message: [String: Any] = ["type": "gap", "id": id, "fromNs": String(from), "cause": cause]
          if let to { message["toNs"] = String(to) }
          try channel.control(message)
        case .end(let reason): try channel.control(["type": "end", "id": id, "reason": reason])
        }
      } catch {
        condition.lock()
        broken = true
        pending.removeAll()
        head = 0
        overflow = nil
        let open = !closing
        condition.unlock()
        if open { failures.append(id, error as? Refused ?? Refused("device-failed", String(describing: error))) }
        return
      }
      if case .audio(_, let pcm) = item {
        condition.lock()
        held -= pcm.count
        condition.unlock()
      }
    }
  }

  private func next() -> Item? {
    condition.lock()
    defer { condition.unlock() }
    while head == pending.count && !closing { condition.wait() }
    guard head < pending.count else { return nil }
    let item = pending[head]
    head += 1
    if head == pending.count {
      pending.removeAll(keepingCapacity: true)
      head = 0
    } else if head >= 256 && head * 2 >= pending.count {
      pending.removeFirst(head)
      head = 0
    }
    return item
  }
}
