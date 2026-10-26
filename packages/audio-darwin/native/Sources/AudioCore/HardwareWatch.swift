import CoreAudio
import Foundation

final class HardwareWatch {
  private struct Registration {
    let device: AudioObjectID
    var address: AudioObjectPropertyAddress
    let callback: AudioObjectPropertyListenerBlock
  }
  private let queue = DispatchQueue(label: "audio.hardware-events")
  private let lock = NSLock()
  private var pending: DeviceLoss?
  private var registrations: [Registration] = []

  func add(_ device: AudioObjectID, _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) throws {
    let callback: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
      guard let self else { return }
      self.lock.lock()
      if self.pending == nil {
        self.pending = DeviceLoss(cause: selector == kAudioDevicePropertyDeviceIsAlive ? "device-lost" : "device-change")
      }
      self.lock.unlock()
    }
    var location = address(selector, scope)
    try check(AudioObjectAddPropertyListenerBlock(device, &location, queue, callback), "Observe output hardware")
    registrations.append(Registration(device: device, address: location, callback: callback))
  }

  func take() -> DeviceLoss? {
    lock.lock()
    defer { lock.unlock() }
    let found = pending
    pending = nil
    return found
  }

  func close() -> [OSStatus] {
    var failures: [OSStatus] = []
    for var registration in registrations {
      let status = AudioObjectRemovePropertyListenerBlock(registration.device, &registration.address, queue, registration.callback)
      if status != noErr && status != kAudioHardwareBadDeviceError { failures.append(status) }
    }
    registrations.removeAll()
    queue.sync {}
    return failures
  }

  deinit { _ = close() }
}
