import AVFoundation
import Foundation
import Realtime

public enum CaptureEvent {
  case audio(UInt64, Data)
  case gap(UInt64, UInt64?, String)
  case failed(Refused)
}

public final class Consumer {
  public let ring: OpaquePointer
  private let channels: UInt32
  private let converter: AVAudioConverter
  private let input: AVAudioPCMBuffer
  private let output: AVAudioPCMBuffer
  private let samples: UnsafeMutablePointer<Float>
  private let capacity: UInt32
  private let emit: (CaptureEvent) -> Void
  private var pending = Data()
  private let rate: Double
  private var anchors: [(frame: UInt64, time: UInt64)] = []
  private var inputFrames: UInt64 = 0
  private var sent: UInt64 = 0
  private var lastEnd: UInt64?
  private let chunkBytes = 640

  public init(rate: Double, channels: UInt32, budgetFrames: UInt32? = nil, emit: @escaping (CaptureEvent) -> Void) throws {
    guard channels > 0, channels <= 32, rate >= 8000, rate <= 192000,
          let source = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
          let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false),
          let converter = AVAudioConverter(from: source, to: target),
          let ring = rt_ring_create(channels, budgetFrames ?? UInt32(rate / 4), HostClock.perFrame(rate)) else {
      throw Refused("device-failed", "Could not allocate capture ring or converter")
    }
    let capacity = rt_ring_largest_record(ring)
    guard let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: capacity),
          let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: UInt32(ceil(Double(capacity) * 16000 / rate)) + 256) else {
      rt_ring_destroy(ring)
      throw Refused("device-failed", "Could not allocate conversion buffers")
    }
    self.ring = ring
    self.rate = rate
    self.channels = channels
    self.converter = converter
    self.input = input
    self.output = output
    self.capacity = capacity
    self.samples = .allocate(capacity: Int(capacity * channels))
    self.emit = emit
    converter.primeMethod = .none
    pending.reserveCapacity(chunkBytes * 2)
  }

  deinit {
    samples.deallocate()
    rt_ring_destroy(ring)
  }

  @discardableResult
  public func drain() throws -> Bool {
    var record = rt_record()
    var consumed = false
    while rt_ring_read(ring, &record, samples, capacity) != RT_RECORD_NONE {
      consumed = true
      if record.kind == RT_RECORD_DROP {
        try discontinuity(HostClock.ns(record.host), HostClock.ns(record.until), "overflow")
        continue
      }
      anchors.append((UInt64(Double(inputFrames) * 16000 / rate), HostClock.ns(record.host)))
      inputFrames += UInt64(record.frames)
      input.frameLength = record.frames
      let mono = input.floatChannelData![0]
      for frame in 0..<Int(record.frames) {
        var sum: Float = 0
        for channel in 0..<Int(channels) { sum += samples[frame * Int(channels) + channel] }
        mono[frame] = sum / Float(channels)
      }
      try convert(input)
    }
    return consumed
  }

  public func finish() throws {
    if rt_ring_faulted(ring) != 0 {
      throw Refused("device-failed", "Capture buffer layout changed")
    }
    try drain()
    var drop = rt_record()
    if rt_ring_take_drop(ring, &drop) != 0 {
      try discontinuity(HostClock.ns(drop.host), HostClock.ns(drop.until), "overflow")
    }
    try convert(nil)
    flush()
  }

  public func discontinuity(_ from: UInt64, _ to: UInt64?, _ cause: String) throws {
    if !anchors.isEmpty { try convert(nil) }
    flush()
    emit(.gap(from, to, cause))
    converter.reset()
    anchors.removeAll(keepingCapacity: true)
    inputFrames = 0
    sent = 0
  }

  public func interrupt(at: UInt64, cause: String) {
    var earliest = anchors.first?.time
    var record = rt_record()
    while rt_ring_read(ring, &record, samples, capacity) != RT_RECORD_NONE {
      let time = HostClock.ns(record.host)
      earliest = min(earliest ?? time, time)
    }
    if rt_ring_take_drop(ring, &record) != 0 {
      let time = HostClock.ns(record.host)
      earliest = min(earliest ?? time, time)
    }
    if rt_ring_take_fault(ring, &record) != 0 {
      let time = HostClock.ns(record.host)
      earliest = min(earliest ?? time, time)
    }
    emit(.gap(lastEnd ?? min(earliest ?? at, at), nil, cause))
    pending.removeAll(keepingCapacity: true)
    converter.reset()
    anchors.removeAll(keepingCapacity: true)
    inputFrames = 0
    sent = 0
  }

  private func convert(_ buffer: AVAudioPCMBuffer?) throws {
    var supplied = false
    while true {
      var error: NSError?
      let status = converter.convert(to: output, error: &error) { _, state in
        if let buffer, !supplied {
          supplied = true
          state.pointee = .haveData
          return buffer
        }
        state.pointee = buffer == nil ? .endOfStream : .noDataNow
        return nil
      }
      if status == .error || error != nil {
        throw Refused("device-failed", "Audio conversion failed: \(error?.localizedDescription ?? "unknown")")
      }
      if output.frameLength > 0 {
        pending.append(UnsafeRawPointer(output.int16ChannelData![0]).assumingMemoryBound(to: UInt8.self), count: Int(output.frameLength) * 2)
        while pending.count >= chunkBytes {
          send(Data(pending.prefix(chunkBytes)))
          pending.removeFirst(chunkBytes)
        }
      }
      if status == .inputRanDry || status == .endOfStream || output.frameLength == 0 { break }
    }
  }

  private func flush() {
    if !pending.isEmpty { send(pending); pending.removeAll(keepingCapacity: true) }
  }

  private func send(_ pcm: Data) {
    while anchors.count > 1 && anchors[1].frame <= sent { anchors.removeFirst() }
    guard let anchor = anchors.first else { return }
    let at = anchor.time + (sent - anchor.frame) * 1_000_000_000 / 16000
    emit(.audio(at, pcm))
    lastEnd = at + UInt64(pcm.count / 2) * 1_000_000_000 / 16000
    sent += UInt64(pcm.count / 2)
  }
}
