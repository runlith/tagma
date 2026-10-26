import AppKit
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())

if arguments.contains("--preflight-accessibility") {
  let trusted = Accessibility.isTrusted()
  OutputWriter.shared.emitSync(.accessibility(AccessibilityData(trusted: trusted, tapActive: false)))
  exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let initial = Accessibility.refresh(announce: false)
Accessibility.watch()
OutputWriter.shared.emit(
  .ready(ReadyData(accessibilityTrusted: initial.trusted, tapActive: initial.tapActive))
)

func shutdown() {
  Clipboard.shared.settle {
    sharedEventTap.stop()
    exit(0)
  }
}

func handleCommand(_ command: InputCommand) {
  switch command.type {
  case "bind":
    sharedEventTap.matcher.bind(Binding.from(command))
  case "swallow":
    sharedEventTap.matcher.swallowing = command.on == true
  case "escape":
    sharedEventTap.matcher.watchingEscape = command.on == true
  case "paste":
    let id = command.id ?? ""
    Clipboard.shared.paste(text: command.text ?? "", restore: command.restore != false) { error in
      OutputWriter.shared.emit(.pasteResult(PasteResultData(id: id, ok: error == nil, error: error)))
    }
  case "prompt-accessibility":
    Accessibility.promptIfNeeded()
    _ = Accessibility.refresh(announce: true)
  case "recheck":
    _ = Accessibility.refresh(announce: true)
  case "shutdown":
    shutdown()
  default:
    OutputWriter.shared.emit(.error(ErrorData(message: "unknown command: \(command.type)")))
  }
}

let stdinReader = StdinLineReader(
  onLine: { line in
    guard let data = line.data(using: .utf8), !data.isEmpty else { return }
    guard let command = try? JSONDecoder().decode(InputCommand.self, from: data) else {
      OutputWriter.shared.emit(.error(ErrorData(message: "invalid command line")))
      return
    }
    DispatchQueue.main.async { handleCommand(command) }
  },
  onEnd: {
    DispatchQueue.main.async { shutdown() }
  })
stdinReader.start()

app.run()
