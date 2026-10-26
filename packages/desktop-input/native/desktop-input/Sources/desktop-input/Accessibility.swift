import ApplicationServices
import Foundation

enum Accessibility {
  private static var reported: AccessibilityData?

  static func isTrusted() -> Bool {
    return AXIsProcessTrusted()
  }

  @discardableResult
  static func promptIfNeeded() -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue()
    let options = [key: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
  }

  static func refresh(announce: Bool) -> AccessibilityData {
    let trusted = isTrusted()
    if trusted {
      _ = sharedEventTap.start()
    } else if sharedEventTap.isActive {
      sharedEventTap.stop()
    }
    let state = AccessibilityData(trusted: trusted, tapActive: sharedEventTap.isActive)
    if let previous = reported, announce || previous.trusted != state.trusted || previous.tapActive != state.tapActive {
      OutputWriter.shared.emit(.accessibility(state))
    }
    reported = state
    return state
  }

  static func watch() {
    DistributedNotificationCenter.default().addObserver(
      forName: NSNotification.Name("com.apple.accessibility.api"),
      object: nil,
      queue: .main
    ) { _ in
      for delay in [0.3, 1.5] {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { _ = refresh(announce: false) }
      }
    }
  }
}
