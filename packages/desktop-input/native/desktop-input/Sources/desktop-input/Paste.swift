import Carbon.HIToolbox
import CoreGraphics
import Foundation

enum Paste {
  private static let qwertyKeyV: CGKeyCode = 9

  static func pasteFromClipboard() -> Bool {
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
      return false
    }
    // Neutralize any physically-held modifiers so the synthetic ⌘V is not
    // polluted by, say, a Shift the user is still pressing.
    source.setLocalEventsFilterDuringSuppressionState([], state: .eventSuppressionStateSuppressionInterval)

    let keyV = resolveKeyCodeForV()
    guard
      let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: true),
      let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: false)
    else {
      return false
    }

    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand

    let tap: CGEventTapLocation = .cgAnnotatedSessionEventTap
    keyDown.post(tap: tap)
    keyUp.post(tap: tap)
    return true
  }

  // Virtual keycodes are layout-dependent (on Dvorak, keycode 9 is not "v").
  // Resolve the keycode that produces "v" under the current keyboard layout;
  // fall back to the QWERTY position only when the layout cannot be read.
  private static func resolveKeyCodeForV() -> CGKeyCode {
    guard
      let inputSource = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
      let layoutDataRef = TISGetInputSourceProperty(inputSource, kTISPropertyUnicodeKeyLayoutData)
    else {
      return qwertyKeyV
    }

    let layoutData = Unmanaged<CFData>.fromOpaque(layoutDataRef).takeUnretainedValue() as Data
    return layoutData.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> CGKeyCode in
      guard let base = bytes.baseAddress else { return qwertyKeyV }
      let layout = base.assumingMemoryBound(to: UCKeyboardLayout.self)

      for keyCode: UInt16 in 0..<128 {
        var deadKeyState: UInt32 = 0
        var chars = [UniChar](repeating: 0, count: 4)
        var length = 0
        let status = UCKeyTranslate(
          layout,
          keyCode,
          UInt16(kUCKeyActionDisplay),
          0,
          UInt32(LMGetKbdType()),
          OptionBits(kUCKeyTranslateNoDeadKeysBit),
          &deadKeyState,
          chars.count,
          &length,
          &chars
        )
        if status == noErr, length > 0, chars[0] == UniChar(UnicodeScalar("v").value) {
          return CGKeyCode(keyCode)
        }
      }
      return qwertyKeyV
    }
  }
}
