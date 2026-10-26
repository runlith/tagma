import Foundation

public final class Session {
  private let channel: Channel
  private let output: Output
  private let mute: Mute
  private let synthetic: Bool
  private let failures = Failures()
  private var captures: [UInt32: (capture: Capture, echo: Bool, sink: CaptureSink)] = [:]
  private var players: [UInt32: Player] = [:]
  private var muteIds = Set<UInt32>()
  private var used = Set<UInt32>()

  public init(_ channel: Channel, _ output: Output, _ mute: Mute, synthetic: Bool) {
    self.channel = channel
    self.synthetic = synthetic
    self.output = output
    self.mute = mute
  }

  public func run(token: String) throws {
    do {
      try channel.control(["type": "hello", "token": token, "nowNs": String(HostClock.now)])
      var running = true
      while running && !channel.eof {
        let frames = try channel.receive()
        if channel.eof { break }
        for frame in frames {
          var resource: UInt32?
          var opening = false
          do {
            switch frame {
            case .control(let object):
              let request = try Request(object)
              if object["id"] != nil {
                let id = try request.id()
                opening = ["capture", "play", "mute"].contains(request.type)
                if opening && used.contains(id) { throw Refused("helper-mismatch", "Resource id was already used") }
                resource = id
              }
              running = try dispatch(request)
            case .audio(let id, let pcm):
              resource = id
              guard let player = players[id] else { throw Refused("helper-mismatch", "Unknown playback resource") }
              try player.write(pcm)
            }
          } catch {
            if error is QuiescenceFailed { throw error }
            if opening, let resource { try refuse(resource, error) }
            else if let resource, captures[resource] != nil || players[resource] != nil || muteIds.contains(resource) {
              try failResource(resource)
            } else { try refuse(nil, error) }
          }
          if !running { break }
        }
        if let loss = output.takeLoss() { try loseOutput(loss) }
        for player in players.values { player.poll() }
        for (id, _) in failures.take() { try failResource(id) }
      }
    } catch {
      let disconnected = channel.eof
      do { try shutdown() } catch { FileHandle.standardError.write(Data("Audio cleanup: \(error)\n".utf8)) }
      if !disconnected { throw error }
      return
    }
    try shutdown()
  }

  private func dispatch(_ request: Request) throws -> Bool {
    if request.type == "quit" { return false }
    if request.type == "devices" {
      let list: [[String: Any]] = synthetic ? [["id": "synthetic", "label": "Synthetic tone"], ["id": "synthetic-gap", "label": "Synthetic overflow"]] : try Hardware.inputs().map { ["id": $0.uid, "label": $0.label] }
      try channel.control(["type": "devices", "list": list, "permissions": ["mic": synthetic ? "granted" : Hardware.microphonePermission, "system": "unknown"]])
      return true
    }
    if request.type == "output" {
      try channel.control(["type": "output", "kind": synthetic ? "unknown" : Hardware.outputKind])
      return true
    }
    let id = try request.id()
    if ["capture", "play", "mute"].contains(request.type) {
      guard used.insert(id).inserted else { throw Refused("helper-mismatch", "Resource id was already used") }
    }
    switch request.type {
    case "capture": try capture(id, request)
    case "play":
      let format = try request.format()
      try output.open()
      let player = try Player(format, output) { [channel, failures] event in
        var message = event
        message["id"] = id
        do { try channel.control(message) }
        catch { failures.append(id, error as? Refused ?? Refused("device-failed", String(describing: error))) }
      }
      players[id] = player
      try channel.control(["type": "ready", "id": id])
    case "stop", "abort": try endCapture(id, drain: request.type == "stop", reason: request.type == "stop" ? "drained" : "aborted")
    case "release":
      if let player = players.removeValue(forKey: id) {
        player.close()
        try channel.control(["type": "end", "id": id, "reason": "released"])
      }
    case "clear", "mark":
      guard let player = players[id] else { throw Refused("helper-mismatch", "Unknown player") }
      if request.type == "clear" { player.clear() }
      else { try player.mark(request.object["mark"] as! String) }
    case "mute":
      try mute.acquire(id)
      muteIds.insert(id)
      try channel.control(["type": "ready", "id": id])
    case "unmute":
      if muteIds.contains(id) {
        try mute.release(id)
        muteIds.remove(id)
        try channel.control(["type": "end", "id": id, "reason": "released"])
      }
    default: throw Refused("helper-mismatch", "Unknown request")
    }
    return true
  }

  private func capture(_ id: UInt32, _ request: Request) throws {
    let sink = CaptureSink(channel, failures, id)
    let echo = request.object["source"] as? String == "mic" && request.object["echoCancel"] as? Bool == true
    let capture: Capture
    if synthetic {
      let device = request.object["device"] as? String ?? "synthetic"
      guard ["synthetic", "synthetic-gap"].contains(device) else { throw Refused("device-missing", "Synthetic device is absent") }
      capture = try Capture(syntheticGap: device == "synthetic-gap", emit: sink.emit)
    } else if request.object["source"] as? String == "system" {
      try output.open()
      if #available(macOS 14.2, *) {
        capture = try Capture(tap: SystemTap(), emit: sink.emit)
      } else { throw Refused("unsupported", "System audio requires macOS 14.2") }
    } else {
      try Hardware.authorizeMicrophone()
      let device = try Hardware.input(request.object["device"] as? String)
      if echo {
        capture = try Capture(voice: output.voice, emit: sink.emit)
        try output.acquireEcho(id, device: device)
      } else { capture = try Capture(device: device, emit: sink.emit) }
    }
    captures[id] = (capture, echo && !synthetic, sink)
    do {
      try capture.start {
        try channel.control(["type": "ready", "id": id, "format": ["rate": 16000, "channels": 1]])
      }
    } catch {
      var fatal: Error?
      do { try capture.stop(drain: false) }
      catch { if error is QuiescenceFailed { fatal = error } }
      sink.abandon()
      if echo && !synthetic {
        do { try output.releaseEcho(id) }
        catch { if error is QuiescenceFailed { fatal = error } }
      }
      if let fatal { throw fatal }
      captures.removeValue(forKey: id)
      throw error
    }
  }

  private func endCapture(_ id: UInt32, drain: Bool, reason: String, loss: DeviceLoss? = nil) throws {
    guard let (capture, echo, sink) = captures[id] else { return }
    var failed = reason == "failed"
    do { try capture.stop(drain: drain, loss: loss) }
    catch {
      if error is QuiescenceFailed { throw error }
      failed = true
    }
    if echo {
      do { try output.releaseEcho(id) }
      catch {
        if error is QuiescenceFailed { throw error }
        failed = true
      }
    }
    captures.removeValue(forKey: id)
    sink.end(failed || capture.failed ? "failed" : reason)
  }

  private func failResource(_ id: UInt32) throws {
    if captures[id] != nil {
      try endCapture(id, drain: false, reason: "failed", loss: DeviceLoss(cause: "device-lost"))
    } else if let player = players.removeValue(forKey: id) {
      player.fail()
      try channel.control(["type": "end", "id": id, "reason": "failed"])
    } else if muteIds.remove(id) != nil {
      do { try mute.release(id) }
      catch { FileHandle.standardError.write(Data("Mute release: \(error)\n".utf8)) }
      try channel.control(["type": "end", "id": id, "reason": "failed"])
    }
  }

  private func loseOutput(_ loss: DeviceLoss) throws {
    try output.close()
    for id in captures.keys.filter({ captures[$0]!.echo }) {
      try endCapture(id, drain: false, reason: "failed", loss: loss)
    }
    for id in Array(players.keys) { try failResource(id) }
  }

  private func shutdown() throws {
    var failure: Error?
    for (capture, _, sink) in captures.values {
      do { try capture.stop(drain: false) } catch { if failure == nil { failure = error } }
      sink.abandon()
    }
    captures.removeAll()
    for player in players.values { player.close() }
    players.removeAll()
    do { try output.close() } catch { if failure == nil { failure = error } }
    do { try mute.restore() } catch { if failure == nil { failure = error } }
    channel.close()
    if let failure { throw failure }
  }

  private func refuse(_ id: UInt32?, _ error: Error) throws {
    let refusal = error as? Refused ?? Refused("device-failed", String(describing: error))
    var message: [String: Any] = ["type": "refused", "code": refusal.code, "message": refusal.message]
    if let id, id > 0 { message["id"] = id }
    try channel.control(message)
  }
}
