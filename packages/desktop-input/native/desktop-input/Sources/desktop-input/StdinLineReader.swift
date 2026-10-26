import Foundation

final class StdinLineReader {
  private let handle = FileHandle.standardInput
  private let onLine: (String) -> Void
  private let onEnd: () -> Void
  private var buffer = Data()

  init(onLine: @escaping (String) -> Void, onEnd: @escaping () -> Void) {
    self.onLine = onLine
    self.onEnd = onEnd
  }

  func start() {
    handle.readabilityHandler = { [weak self] handle in
      guard let self else { return }
      let chunk = handle.availableData
      if chunk.isEmpty {
        handle.readabilityHandler = nil
        self.onEnd()
        return
      }
      self.buffer.append(chunk)
      self.drainLines()
    }
  }

  private func drainLines() {
    while let newlineIndex = buffer.firstIndex(of: 0x0A) {
      let lineData = buffer.subdata(in: buffer.startIndex..<newlineIndex)
      buffer.removeSubrange(buffer.startIndex...newlineIndex)
      if let line = String(data: lineData, encoding: .utf8) {
        onLine(line.trimmingCharacters(in: .whitespacesAndNewlines))
      }
    }
  }
}
