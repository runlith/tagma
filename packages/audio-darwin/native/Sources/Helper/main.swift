import AudioCore
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
func argument(_ name: String) -> String? {
  guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
  return arguments[index + 1]
}

guard let path = argument("--socket"), let token = argument("--token"), let data = argument("--data") else {
  FileHandle.standardError.write(Data("Expected --socket, --token and --data\n".utf8))
  exit(2)
}

Thread.detachNewThread {
  do {
    let synthetic = arguments.contains("--synthetic")
    let device: MuteDevice = synthetic ? MemoryMute() : OutputMute()
    let journalDirectory = "\(data)/audio-mute"
    MuteJournal.recover(directory: journalDirectory, device: device)
    let channel = try Channel(path: path)
    let output = try Output(synthetic: synthetic)
    let mute = Mute(device, journal: MuteJournal(directory: journalDirectory))
    let session = Session(channel, output, mute, synthetic: synthetic)
    try session.run(token: token)
    exit(0)
  } catch {
    FileHandle.standardError.write(Data("Audio helper: \(error)\n".utf8))
    exit(1)
  }
}
CFRunLoopRun()
