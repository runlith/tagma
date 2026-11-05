import CoreGraphics
import Darwin
import Foundation

typealias ErrorOut = AutoreleasingUnsafeMutablePointer<AnyObject?>?
typealias MouseMessage = @convention(c) (
  UnsafeMutablePointer<CGPoint>?, UnsafeMutablePointer<CGPoint>?, UInt32, UInt, CGSize, UInt32
) -> UnsafeMutableRawPointer

@objc protocol ServiceContextClass {
  @objc(sharedServiceContextForDeveloperDir:error:)
  func shared(_ developerDirectory: String, error: ErrorOut) -> AnyObject?
}

@objc protocol ServiceContext {
  @objc(deviceSetWithPath:error:)
  func deviceSet(_ path: String, error: ErrorOut) -> AnyObject?
}

@objc protocol DeviceSet {
  @objc var devicesByUDID: NSDictionary { get }
}

@objc protocol LegacyHIDClient {
  @objc(initWithDevice:error:)
  func initWithDevice(_ device: Any, error: ErrorOut) -> AnyObject?

  @objc(sendWithMessage:freeWhenDone:completionQueue:completion:)
  func send(
    withMessage message: UnsafeMutableRawPointer, freeWhenDone: Bool, completionQueue: DispatchQueue,
    completion: @escaping (Error?) -> Void)
}

struct Sample {
  let at: UInt64
  let x: Double
  let y: Double
  let down: Bool
}

let interval = 1.0 / 120
let step = 5.0
let messageSize = 0x140
let payloadSize = 0x90
let touchSize = 0x70
let digitizerTarget: UInt32 = 0x32

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func describe(_ error: AnyObject?) -> String {
  (error as? NSError)?.localizedDescription ?? "no error was given"
}

func put<T>(_ value: T, _ base: UnsafeMutableRawPointer, _ offset: Int) {
  withUnsafeBytes(of: value) { base.advanced(by: offset).copyMemory(from: $0.baseAddress!, byteCount: $0.count) }
}

func emit(_ object: Any, to handle: FileHandle) {
  var line = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
  line.append(0x0a)
  handle.write(line)
}

func developerDirectory() -> String {
  if let directory = ProcessInfo.processInfo.environment["DEVELOPER_DIR"], !directory.isEmpty { return directory }
  let process = Process()
  let output = Pipe()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
  process.arguments = ["-p"]
  process.standardOutput = output
  do { try process.run() } catch { fail("xcode-select could not start: \(error)") }
  process.waitUntilExit()
  let path = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  if process.terminationStatus != 0 || path.isEmpty { fail("xcode-select named no developer directory") }
  return path
}

func load(_ path: String) -> UnsafeMutableRawPointer {
  guard let handle = dlopen(path, RTLD_NOW) else { fail("\(path) did not load: \(String(cString: dlerror()))") }
  return handle
}

let arguments = CommandLine.arguments
guard arguments.count == 3, let udid = UUID(uuidString: arguments[2]) else { fail("usage: digitizer <device-set> <udid>") }
let developer = developerDirectory()
_ = load("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator")
let kit = load(developer + "/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit")
guard let builder = dlsym(kit, "IndigoHIDMessageForMouseNSEvent") else { fail("SimulatorKit has no IndigoHIDMessageForMouseNSEvent") }
let mouseMessage = unsafeBitCast(builder, to: MouseMessage.self)

guard let contextClass = NSClassFromString("SimServiceContext") else { fail("CoreSimulator has no SimServiceContext") }
var failure: AnyObject?
guard let context = unsafeBitCast(contextClass as AnyObject, to: ServiceContextClass.self).shared(developer, error: &failure)
else { fail("CoreSimulator gave no service context: \(describe(failure))") }
guard let set = unsafeBitCast(context, to: ServiceContext.self).deviceSet(arguments[1], error: &failure)
else { fail("the device set \(arguments[1]) did not open: \(describe(failure))") }
guard let device = unsafeBitCast(set, to: DeviceSet.self).devicesByUDID[udid as NSUUID] as? NSObject
else { fail("the device set \(arguments[1]) holds no device \(udid)") }
guard let screen = (device.value(forKeyPath: "deviceType.mainScreenSize") as? NSValue)?.sizeValue,
  let scale = (device.value(forKeyPath: "deviceType.mainScreenScale") as? NSNumber)?.doubleValue,
  screen.width > 0, screen.height > 0
else { fail("device \(udid) reports no main screen geometry") }

guard let clientClass = NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient") else {
  fail("SimulatorKit has no SimDeviceLegacyHIDClient")
}
guard let allocated = class_createInstance(clientClass, 0) else { fail("SimDeviceLegacyHIDClient could not be allocated") }
guard let created = unsafeBitCast(allocated as AnyObject, to: LegacyHIDClient.self).initWithDevice(device, error: &failure)
else { fail("SimDeviceLegacyHIDClient refused device \(udid): \(describe(failure))") }
let client = unsafeBitCast(created, to: LegacyHIDClient.self)
let acknowledgements = DispatchQueue(label: "digitizer.acknowledgements")
let pending = DispatchGroup()
var deliveryFailure: Error?

var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func ticks(_ seconds: Double) -> UInt64 {
  UInt64((seconds * 1e9 * Double(timebase.denom) / Double(timebase.numer)).rounded())
}
func milliseconds(_ ticks: UInt64) -> Double {
  (Double(ticks) * Double(timebase.numer) / Double(timebase.denom) / 1e5).rounded() / 10
}

func message(_ sample: Sample) -> UnsafeMutableRawPointer {
  var ratio = CGPoint(x: sample.x * scale / screen.width, y: sample.y * scale / screen.height)
  let source = mouseMessage(&ratio, nil, digitizerTarget, sample.down ? 1 : 2, CGSize(width: 1, height: 1), 0)
  put(Double(ratio.x), source, 0x3c)
  put(Double(ratio.y), source, 0x44)
  guard let built = calloc(1, messageSize) else { fail("an Indigo touch message could not be allocated") }
  put(UInt32(payloadSize), built, 0x18)
  put(UInt8(2), built, 0x1c)
  put(UInt32(0xb), built, 0x20)
  put(sample.at, built, 0x24)
  built.advanced(by: 0x30).copyMemory(from: source.advanced(by: 0x30), byteCount: touchSize)
  free(source)
  let second = 0x20 + payloadSize
  built.advanced(by: second).copyMemory(from: built.advanced(by: 0x20), byteCount: payloadSize)
  put(UInt32(1), built, second + 0x10)
  put(UInt32(2), built, second + 0x14)
  return built
}

func deliver(_ sample: Sample) {
  pending.enter()
  client.send(withMessage: message(sample), freeWhenDone: true, completionQueue: acknowledgements) { error in
    if let error, deliveryFailure == nil { deliveryFailure = error }
    pending.leave()
  }
}

func play(_ phase: String, _ samples: [Sample], from origin: UInt64) {
  var planned: [Double] = []
  var sent: [Double] = []
  for sample in samples {
    while mach_absolute_time() < sample.at { mach_wait_until(sample.at) }
    let now = mach_absolute_time()
    deliver(sample)
    planned.append(milliseconds(sample.at - origin))
    sent.append(milliseconds(now - origin))
  }
  emit([phase: ["planned": planned, "sent": sent]], to: FileHandle.standardError)
}

func number(_ command: [String: Any], _ key: String) -> Double {
  guard let value = command[key] as? NSNumber else { fail("the touch command has no number \(key): \(command)") }
  return value.doubleValue
}

var finger: (x: Double, y: Double)?
while let line = readLine() {
  guard let command = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any],
    let id = command["id"] as? NSNumber, let phase = command["phase"] as? String
  else { fail("the touch command is not a JSON object with an id and a phase: \(line)") }
  let now = mach_absolute_time()
  switch phase {
  case "press":
    if finger != nil { fail("the digitizer already holds a finger") }
    let point = (x: number(command, "x"), y: number(command, "y"))
    deliver(Sample(at: now, x: point.x, y: point.y, down: true))
    finger = point
  case "move":
    guard let from = finger else { fail("the digitizer has no finger to move") }
    let to = (x: number(command, "x"), y: number(command, "y"))
    let steps = max(2, Int((hypot(to.x - from.x, to.y - from.y) / step).rounded(.up)) * 2)
    play("move", (1...steps).map { index in
      let t = Double(index) / Double(steps)
      let eased = t * t * t * (t * (t * 6 - 15) + 10)
      return Sample(
        at: now + ticks(interval * Double(index)), x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased, down: true)
    }, from: now)
    finger = to
  case "swipe":
    guard let from = finger else { fail("the digitizer has no finger to swipe") }
    guard let end = command["to"] as? [String: Any] else { fail("the swipe has no target: \(command)") }
    let to = (x: number(end, "x"), y: number(end, "y"))
    let duration = number(command, "duration")
    let resolution = Int((hypot(to.x - from.x, to.y - from.y) / number(command, "delta")).rounded(.up))
    let steps = max(2, min(resolution, Int((duration / interval).rounded(.down))))
    let spacing = duration / Double(steps)
    var samples = (1...steps).map { index in
      let fraction = Double(index) / Double(steps)
      return Sample(
        at: now + ticks(spacing * Double(index)), x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction, down: true)
    }
    samples.append(Sample(at: now + ticks(spacing * Double(steps + 1)), x: to.x, y: to.y, down: false))
    play("swipe", samples, from: now)
    finger = nil
  case "release":
    if finger == nil { fail("the digitizer has no finger to release") }
    deliver(Sample(at: now, x: number(command, "x"), y: number(command, "y"), down: false))
    finger = nil
  default:
    fail("unknown touch phase: \(phase)")
  }
  pending.wait()
  if let error = acknowledgements.sync(execute: { deliveryFailure }) {
    fail("the simulator refused a touch message: \(error.localizedDescription)")
  }
  emit(["id": id, "value": NSNull()], to: FileHandle.standardOutput)
}
