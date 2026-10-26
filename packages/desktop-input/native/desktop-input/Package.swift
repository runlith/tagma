// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "desktop-input",
  platforms: [
    .macOS("13.0")
  ],
  targets: [
    .executableTarget(name: "desktop-input")
  ]
)
