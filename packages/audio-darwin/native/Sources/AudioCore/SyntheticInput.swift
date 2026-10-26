import CoreAudio
import Foundation
import Realtime

final class SyntheticInput {
  private let ring: OpaquePointer
  private let overflow: Bool
  private let queue = DispatchQueue(label: "audio.synthetic-input")
  private let samples = UnsafeMutablePointer<Float>.allocate(capacity: 960)
  private var timer: DispatchSourceTimer?
  private var frame: UInt64 = 0
  private var origin: UInt64 = 0

  init(_ ring: OpaquePointer, overflow: Bool) {
    self.ring = ring
    self.overflow = overflow
  }

  deinit { stop(); samples.deallocate() }

  func start() {
    origin = HostClock.now
    if overflow {
      for _ in 0..<64 { produce() }
    }
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + (overflow ? .milliseconds(640) : .milliseconds(0)), repeating: .milliseconds(10))
    timer.setEventHandler { [self] in
      let due = (HostClock.now - origin) * 48000 / 1_000_000_000
      repeat { produce() } while frame + 480 <= due
    }
    self.timer = timer
    timer.resume()
  }

  func stop(drain: Bool = false) {
    guard let timer else { return }
    timer.cancel()
    self.timer = nil
    queue.sync {
      if drain { produce(frames: 3) }
    }
  }

  private func produce(frames: UInt32 = 480) {
    for index in 0..<Int(frames) {
      let phase = Double(frame + UInt64(index)) * 440 * 2 * .pi / 48000
      samples[index * 2] = Float(sin(phase)) * 0.1
      samples[index * 2 + 1] = Float(sin(phase)) * 0.3
    }
    var list = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2, mDataByteSize: frames * 8, mData: samples))
    rt_ring_write(ring, &list, frames, HostClock.ticks(origin + frame * 1_000_000_000 / 48000))
    frame += UInt64(frames)
  }
}
