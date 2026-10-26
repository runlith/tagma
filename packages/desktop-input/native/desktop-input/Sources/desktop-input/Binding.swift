import CoreGraphics
import Foundation

enum Binding {
  case key(keyCode: Int, required: CGEventFlags)
  case modifier(keyCode: Int, mask: CGEventFlags)

  static let chordMask: CGEventFlags = [.maskCommand, .maskControl, .maskAlternate, .maskShift]

  static func mask(of name: String) -> CGEventFlags? {
    switch name {
    case "command": return .maskCommand
    case "control": return .maskControl
    case "option": return .maskAlternate
    case "shift": return .maskShift
    case "fn": return .maskSecondaryFn
    default: return nil
    }
  }

  static func from(_ command: InputCommand) -> Binding? {
    guard let keyCode = command.keyCode else { return nil }
    if command.kind == "modifier" {
      guard let name = command.modifier, let mask = mask(of: name) else { return nil }
      return .modifier(keyCode: keyCode, mask: mask)
    }
    var required: CGEventFlags = []
    for name in command.modifiers ?? [] {
      guard let mask = mask(of: name), Binding.chordMask.contains(mask) else { return nil }
      required.insert(mask)
    }
    return .key(keyCode: keyCode, required: required)
  }
}

final class Matcher {
  static let escapeKeyCode = 53

  private var binding: Binding?
  private var pending: Binding??
  private var holding = false
  private var swallowedHold = false
  var swallowing = false
  var watchingEscape = false

  func bind(_ next: Binding?) {
    if holding {
      pending = .some(next)
      return
    }
    binding = next
  }

  func handle(type: CGEventType, keyCode: Int, flags: CGEventFlags, repeating: Bool) -> Bool {
    if type == .keyDown, keyCode == Matcher.escapeKeyCode, watchingEscape, !repeating {
      OutputWriter.shared.emit(.escape)
    }
    guard let binding else { return false }
    switch binding {
    case .key(let bound, let required):
      guard keyCode == bound else { return false }
      if type == .keyDown {
        if holding { return swallowing || swallowedHold }
        guard !repeating, flags.intersection(Binding.chordMask) == required else { return false }
        holding = true
        swallowedHold = swallowing
        OutputWriter.shared.emit(.hold(HoldData(transition: .start, shift: false)))
        return swallowedHold
      }
      if type == .keyUp, holding {
        let swallowed = swallowedHold
        finish(.end, shift: flags.contains(.maskShift))
        return swallowed
      }
      return false
    case .modifier(let bound, let mask):
      if type == .keyDown, holding {
        finish(.cancel, shift: false)
      } else if type == .flagsChanged {
        let down = flags.contains(mask)
        if !holding, down, keyCode == bound {
          holding = true
          OutputWriter.shared.emit(.hold(HoldData(transition: .start, shift: false)))
        } else if holding, !down {
          finish(.end, shift: flags.contains(.maskShift))
        }
      }
      return false
    }
  }

  func reconcile() {
    guard holding, let binding else { return }
    let flags = CGEventSource.flagsState(.combinedSessionState)
    switch binding {
    case .key(let bound, _):
      if !CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(bound)) {
        finish(.end, shift: flags.contains(.maskShift))
      }
    case .modifier(_, let mask):
      if !flags.contains(mask) { finish(.end, shift: flags.contains(.maskShift)) }
    }
  }

  func lose() {
    holding = false
    swallowedHold = false
    if let next = pending {
      binding = next
      pending = nil
    }
  }

  private func finish(_ transition: HoldTransition, shift: Bool) {
    holding = false
    swallowedHold = false
    OutputWriter.shared.emit(.hold(HoldData(transition: transition, shift: shift)))
    if let next = pending {
      binding = next
      pending = nil
    }
  }
}
