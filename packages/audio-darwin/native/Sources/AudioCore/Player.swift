import AVFoundation
import Foundation
import Realtime

public final class Player {
  private let ring: OpaquePointer
  private let mixer: OpaquePointer
  private let format: PCMFormat
  private let converter: AVAudioConverter
  private let source: AVAudioFormat
  private let target: AVAudioFormat
  private let emit: ([String: Any]) -> Void
  private struct Mark { let name: String; let position: UInt64; let serial: UInt64 }
  private struct Clear { let target: UInt64; let mark: UInt64; let serial: UInt64 }
  private var marks: [Mark] = []
  private var clears: [Clear] = []
  private var markSerial: UInt64 = 0
  private var clearSerial: UInt64 = 0
  private var credits: [(UInt64, Double)] = []
  private var closed = false

  public init(_ format: PCMFormat, _ output: Output, emit: @escaping ([String: Any]) -> Void) throws {
    guard let source = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.rate, channels: 1, interleaved: false),
          let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false),
          let converter = AVAudioConverter(from: source, to: target), let ring = rt_player_create(96000) else {
      throw Refused("device-failed", "Could not allocate player")
    }
    guard rt_mixer_attach(output.mixer, ring) != 0 else {
      rt_player_destroy(ring)
      throw Refused("unsupported", "All output mixer slots are occupied")
    }
    self.ring = ring
    self.mixer = output.mixer
    self.format = format
    self.converter = converter
    self.source = source
    self.target = target
    self.emit = emit
    converter.primeMethod = .none
  }

  deinit { close(); rt_player_destroy(ring) }

  public func write(_ pcm: Data) throws {
    let frameBytes = Int(format.channels) * 2
    guard pcm.count > 0, pcm.count % frameBytes == 0 else { throw Refused("helper-mismatch", "Playback has an incomplete PCM frame") }
    let frames = pcm.count / frameBytes
    guard Double(frames) <= format.rate else { throw Refused("helper-mismatch", "Playback exceeds the one-second credit window") }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: UInt32(frames)) else { throw Refused("device-failed", "Could not allocate playback conversion") }
    buffer.frameLength = UInt32(frames)
    pcm.withUnsafeBytes { raw in
      for frame in 0..<frames {
        var sum: Float = 0
        for channel in 0..<Int(format.channels) {
          let value = raw.loadUnaligned(fromByteOffset: (frame * Int(format.channels) + channel) * 2, as: Int16.self)
          sum += Float(Int16(littleEndian: value)) / 32768
        }
        buffer.floatChannelData![0][frame] = sum / Float(format.channels)
      }
    }
    try convert(buffer)
    credits.append((rt_player_written(ring), Double(frames) * 1000 / format.rate))
  }

  public func mark(_ name: String) throws {
    try convert(nil)
    converter.reset()
    markSerial += 1
    marks.append(Mark(name: name, position: rt_player_written(ring), serial: markSerial))
    poll()
  }

  public func clear() {
    poll()
    clearSerial += 1
    let clear = Clear(target: rt_player_written(ring), mark: markSerial, serial: clearSerial)
    clears.append(clear)
    if clears.count == 1 { rt_player_clear(ring, clear.target, clear.serial) }
    converter.reset()
  }

  public func poll() {
    guard !closed else { return }
    if let clear = clears.first {
      var from: UInt64 = 0
      var to: UInt64 = 0
      if rt_player_ack(ring, clear.serial, &from, &to) != 0 {
        while let mark = marks.first, mark.serial <= clear.mark {
          marks.removeFirst()
          emit(["type": "marked", "mark": mark.name, "outcome": mark.position > from && mark.position <= to ? "cleared" : "played"])
        }
        clears.removeFirst()
        if let next = clears.first { rt_player_clear(ring, next.target, next.serial) }
      }
    }
    let position = rt_player_position(ring)
    while let first = credits.first, first.0 <= position {
      credits.removeFirst()
      emit(["type": "played", "ms": first.1])
    }
    while clears.isEmpty, let first = marks.first, first.position <= position {
      marks.removeFirst()
      emit(["type": "marked", "mark": first.name, "outcome": "played"])
    }
  }

  public func fail() {
    guard !closed else { return }
    rt_mixer_detach(mixer, ring)
    poll()
    let position = rt_player_position(ring)
    for mark in marks {
      emit(["type": "marked", "mark": mark.name, "outcome": mark.position <= position ? "played" : "cleared"])
    }
    for (_, ms) in credits { emit(["type": "played", "ms": ms]) }
    marks.removeAll()
    credits.removeAll()
    clears.removeAll()
    closed = true
  }

  public func close() {
    guard !closed else { return }
    closed = true
    rt_mixer_detach(mixer, ring)
    marks.removeAll()
    credits.removeAll()
  }

  private func convert(_ buffer: AVAudioPCMBuffer?) throws {
    let frames = buffer.map { UInt32(ceil(Double($0.frameLength) * 48000 / format.rate)) + 256 } ?? 256
    guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: frames) else { throw Refused("device-failed", "Could not allocate converted playback") }
    var supplied = false
    while true {
      var error: NSError?
      let status = converter.convert(to: converted, error: &error) { _, state in
        if let buffer, !supplied { supplied = true; state.pointee = .haveData; return buffer }
        state.pointee = buffer == nil ? .endOfStream : .noDataNow
        return nil
      }
      if status == .error || error != nil { throw Refused("device-failed", "Playback conversion failed: \(error?.localizedDescription ?? "unknown")") }
      if converted.frameLength > 0 {
        guard rt_player_write(ring, converted.floatChannelData![0], converted.frameLength) == converted.frameLength else {
          throw Refused("helper-mismatch", "Playback exceeded its credit window")
        }
      }
      if status == .inputRanDry || status == .endOfStream || converted.frameLength == 0 { break }
    }
  }
}
