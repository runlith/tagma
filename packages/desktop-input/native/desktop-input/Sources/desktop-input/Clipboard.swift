import AppKit
import Foundation

final class Clipboard {
  static let shared = Clipboard()

  private let pasteWindow = 0.25
  private var waiting: [() -> Void] = []
  private var busy = false
  private var idle: (() -> Void)?

  func paste(text: String, restore: Bool, done: @escaping (String?) -> Void) {
    waiting.append { [weak self] in self?.run(text: text, restore: restore, done: done) }
    next()
  }

  func settle(then finish: @escaping () -> Void) {
    if !busy && waiting.isEmpty { return finish() }
    idle = finish
  }

  private func next() {
    guard !busy else { return }
    guard !waiting.isEmpty else {
      let finish = idle
      idle = nil
      finish?()
      return
    }
    busy = true
    waiting.removeFirst()()
  }

  private func release() {
    busy = false
    next()
  }

  private func run(text: String, restore: Bool, done: (String?) -> Void) {
    let board = NSPasteboard.general
    let saved = restore ? snapshot(board) : nil
    board.clearContents()
    guard board.setString(text, forType: .string) else {
      done("the transcript could not be written to the clipboard")
      return release()
    }
    let owned = board.changeCount
    guard Accessibility.isTrusted() else {
      done("untrusted")
      return release()
    }
    guard Paste.pasteFromClipboard() else {
      done("the paste keystroke could not be posted")
      return release()
    }
    done(nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + pasteWindow) { [weak self] in
      if let saved, board.changeCount == owned {
        board.clearContents()
        if !saved.isEmpty { board.writeObjects(saved) }
      }
      self?.release()
    }
  }

  private func snapshot(_ board: NSPasteboard) -> [NSPasteboardItem]? {
    guard let items = board.pasteboardItems else { return nil }
    var copies: [NSPasteboardItem] = []
    for item in items {
      let copy = NSPasteboardItem()
      for type in item.types {
        guard let data = item.data(forType: type) else { return nil }
        copy.setData(data, forType: type)
      }
      copies.append(copy)
    }
    return copies
  }
}
