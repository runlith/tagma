import Foundation

private struct Envelope<Payload: Encodable>: Encodable {
  let message_type: String
  let data: Payload
}

final class OutputWriter {
  static let shared = OutputWriter()

  private let queue = DispatchQueue(label: "dev.runlith.desktop-input.output")
  private let encoder = JSONEncoder()

  private init() {}

  func emit(_ message: OutputMessage) {
    guard let payload = encode(message) else { return }
    queue.async {
      FileHandle.standardOutput.write(payload)
    }
  }

  func emitSync(_ message: OutputMessage) {
    guard let payload = encode(message) else { return }
    FileHandle.standardOutput.write(payload)
  }

  private func encode(_ message: OutputMessage) -> Data? {
    var line: Data?
    switch message {
    case .ready(let data): line = try? encoder.encode(Envelope(message_type: "ready", data: data))
    case .hold(let data): line = try? encoder.encode(Envelope(message_type: "hold", data: data))
    case .escape: line = try? encoder.encode(Envelope(message_type: "escape", data: EmptyData()))
    case .accessibility(let data): line = try? encoder.encode(Envelope(message_type: "accessibility", data: data))
    case .pasteResult(let data): line = try? encoder.encode(Envelope(message_type: "paste_result", data: data))
    case .error(let data): line = try? encoder.encode(Envelope(message_type: "error", data: data))
    }
    line?.append(0x0A)
    return line
  }
}
