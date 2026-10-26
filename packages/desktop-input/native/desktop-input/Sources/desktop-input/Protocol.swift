import Foundation

enum HoldTransition: String, Encodable {
  case start
  case end
  case cancel
}

struct HoldData: Encodable {
  let transition: HoldTransition
  let shift: Bool
}

struct AccessibilityData: Encodable {
  let trusted: Bool
  let tapActive: Bool
}

struct PasteResultData: Encodable {
  let id: String
  let ok: Bool
  let error: String?
}

struct ErrorData: Encodable {
  let message: String
}

struct ReadyData: Encodable {
  let accessibilityTrusted: Bool
  let tapActive: Bool
}

struct EmptyData: Encodable {}

enum OutputMessage {
  case ready(ReadyData)
  case hold(HoldData)
  case escape
  case accessibility(AccessibilityData)
  case pasteResult(PasteResultData)
  case error(ErrorData)
}

struct InputCommand: Decodable {
  let type: String
  let id: String?
  let text: String?
  let restore: Bool?
  let kind: String?
  let keyCode: Int?
  let modifier: String?
  let modifiers: [String]?
  let on: Bool?
}
