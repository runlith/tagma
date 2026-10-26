// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "AudioHelper",
  platforms: [.macOS(.v13)],
  products: [.executable(name: "audio-helper", targets: ["Helper"])],
  targets: [
    .target(name: "Realtime", linkerSettings: [.linkedFramework("AudioToolbox"), .linkedFramework("CoreAudio")]),
    .target(name: "AudioCore", dependencies: ["Realtime"]),
    .executableTarget(name: "Helper", dependencies: ["AudioCore"]),
    .testTarget(name: "AudioCoreTests", dependencies: ["AudioCore", "Realtime"]),
    .testTarget(name: "AudioIntegrationTests", dependencies: ["AudioCore"]),
  ]
)
