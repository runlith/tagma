import CoreGraphics
import Foundation

final class EventTap {
  let matcher = Matcher()
  private var machPort: CFMachPort?
  private var runLoopSource: CFRunLoopSource?

  var isActive: Bool { machPort != nil }

  func start() -> Bool {
    if isActive { return true }

    let mask =
      (1 << CGEventType.keyDown.rawValue)
      | (1 << CGEventType.keyUp.rawValue)
      | (1 << CGEventType.flagsChanged.rawValue)

    guard
      let port = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: CGEventMask(mask),
        callback: eventTapCallback,
        userInfo: nil
      )
    else {
      return false
    }

    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: port, enable: true)

    machPort = port
    runLoopSource = source
    return true
  }

  func reenable() {
    if let port = machPort {
      CGEvent.tapEnable(tap: port, enable: true)
    }
    matcher.reconcile()
  }

  func stop() {
    if let source = runLoopSource {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
    }
    if let port = machPort {
      CGEvent.tapEnable(tap: port, enable: false)
      CFMachPortInvalidate(port)
    }
    runLoopSource = nil
    machPort = nil
    matcher.lose()
  }
}

let sharedEventTap = EventTap()

private let ownProcess = Int64(getpid())

private func eventTapCallback(
  proxy: CGEventTapProxy,
  type: CGEventType,
  event: CGEvent,
  userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
  switch type {
  case .tapDisabledByTimeout, .tapDisabledByUserInput:
    sharedEventTap.reenable()
    return Unmanaged.passUnretained(event)
  case .keyDown, .keyUp, .flagsChanged:
    if event.getIntegerValueField(.eventSourceUnixProcessID) == ownProcess {
      return Unmanaged.passUnretained(event)
    }
    let swallowed = sharedEventTap.matcher.handle(
      type: type,
      keyCode: Int(event.getIntegerValueField(.keyboardEventKeycode)),
      flags: event.flags,
      repeating: event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    )
    return swallowed ? nil : Unmanaged.passUnretained(event)
  default:
    return Unmanaged.passUnretained(event)
  }
}
