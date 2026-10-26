import AudioCore
import AVFoundation
import Realtime
import XCTest

final class CaptureTests: XCTestCase {
  func testSyntheticStopEndsWithAPartialChunk() throws {
    let ready = DispatchSemaphore(value: 0)
    var chunks: [Int] = []
    var failures: [String] = []
    let capture = try Capture(syntheticGap: false) { event in
      switch event {
      case .audio(_, let pcm):
        chunks.append(pcm.count)
        if chunks.count == 1 { ready.signal() }
      case .failed(let error): failures.append(error.message)
      case .gap: failures.append("Unexpected gap")
      }
    }
    try capture.start()
    let started = ready.wait(timeout: .now() + 1)
    try capture.stop(drain: true)
    XCTAssertEqual(started, .success)
    XCTAssertTrue(failures.isEmpty)
    XCTAssertGreaterThan(chunks.count, 1)
    XCTAssertGreaterThan(chunks.last ?? 0, 0)
    XCTAssertLessThan(chunks.last ?? 640, chunks.first ?? 640)
  }

  func testPlanarChannelsAndDrainedTail() throws {
    var chunks: [(UInt64, Data)] = []
    let consumer = try Consumer(rate: 16000, channels: 2) { event in
      if case .audio(let time, let bytes) = event { chunks.append((time, bytes)) }
    }
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 2, interleaved: false)!
    let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 337)!
    input.frameLength = 337
    for i in 0..<337 {
      input.floatChannelData![0][i] = 0.125
      input.floatChannelData![1][i] = 0.375
    }
    rt_ring_write(consumer.ring, input.audioBufferList, 337, HostClock.ticks(1_000_000_000))
    try consumer.finish()
    XCTAssertEqual(chunks.map { $0.1.count }, [640, 34])
    XCTAssertEqual(chunks.map { $0.0 }, [1_000_000_000, 1_020_000_000])
    for (_, bytes) in chunks {
      bytes.withUnsafeBytes { raw in
        for i in 0..<bytes.count / 2 { XCTAssertEqual(raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self), 8192, accuracy: 1) }
      }
    }
  }

  func testDeviceLossCoversQueuedAudioBeforeTheNotification() throws {
    var gaps: [UInt64] = []
    let consumer = try Consumer(rate: 16000, channels: 1) { event in
      if case .gap(let from, _, _) = event { gaps.append(from) }
    }
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 320)!
    input.frameLength = 320
    input.floatChannelData![0].initialize(repeating: 0.1, count: 320)
    rt_ring_write(consumer.ring, input.audioBufferList, 320, HostClock.ticks(1_000_000_000))
    try consumer.drain()
    rt_ring_write(consumer.ring, input.audioBufferList, 320, HostClock.ticks(1_020_000_000))
    consumer.interrupt(at: 1_200_000_000, cause: "device-lost")
    XCTAssertEqual(gaps, [1_020_000_000])
  }

  func testLayoutFaultKeepsTheFirstLostHostTime() throws {
    var gaps: [UInt64] = []
    let consumer = try Consumer(rate: 16000, channels: 1) { event in
      if case .gap(let from, _, _) = event { gaps.append(from) }
    }
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 2, interleaved: false)!
    let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16)!
    input.frameLength = 16
    rt_ring_write(consumer.ring, input.audioBufferList, 16, HostClock.ticks(3_000_000_000))
    XCTAssertEqual(rt_ring_faulted(consumer.ring), 1)
    consumer.interrupt(at: 4_000_000_000, cause: "device-change")
    XCTAssertEqual(gaps, [3_000_000_000])
  }

  func testOverflowAnnouncesLostRangeIncludingStoppedTail() throws {
    var gaps: [(UInt64, UInt64?)] = []
    let consumer = try Consumer(rate: 16000, channels: 1, budgetFrames: 16) { event in
      if case .gap(let from, let to, _) = event { gaps.append((from, to)) }
    }
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
    input.frameLength = 512
    input.floatChannelData![0].initialize(repeating: 0.1, count: 512)
    rt_ring_write(consumer.ring, input.audioBufferList, 512, HostClock.ticks(2_000_000_000))
    rt_ring_write(consumer.ring, input.audioBufferList, 512, HostClock.ticks(2_032_000_000))
    try consumer.finish()
    XCTAssertEqual(gaps.count, 1)
    XCTAssertEqual(gaps[0].0, 2_000_000_000)
    XCTAssertEqual(gaps[0].1, 2_064_000_000)
  }
}
