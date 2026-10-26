import AudioCore
import Realtime
import XCTest

final class PlaybackTests: XCTestCase {
  func testClearAcknowledgesTheRenderedPrefixAndSkippedSuffix() {
    let mixer = rt_mixer_create(64)!
    let player = rt_player_create(128)!
    defer { rt_mixer_detach(mixer, player); rt_player_destroy(player); rt_mixer_destroy(mixer) }
    XCTAssertEqual(rt_mixer_attach(mixer, player), 1)
    var input = [Float](repeating: 0.25, count: 96)
    var output = [Float](repeating: 0, count: 64)
    XCTAssertEqual(rt_player_write(player, &input, 96), 96)
    rt_mixer_render(mixer, &output, 64)
    rt_player_clear(player, 96, 1)
    rt_mixer_render(mixer, &output, 1)
    var from: UInt64 = 0
    var to: UInt64 = 0
    XCTAssertEqual(rt_player_ack(player, 1, &from, &to), 1)
    XCTAssertEqual(from, 64)
    XCTAssertEqual(to, 96)
    XCTAssertEqual(output[0], 0)
    XCTAssertEqual(rt_player_write(player, &input, 96), 96)
    rt_player_clear(player, 192, 2)
    rt_mixer_render(mixer, &output, 1)
    XCTAssertEqual(rt_player_ack(player, 2, &from, &to), 1)
    XCTAssertEqual(from, 96)
    XCTAssertEqual(to, 192)
  }

  func testOrderedClearsKeepLaterMarksSeparate() throws {
    let output = try Output(synthetic: true)
    var marks: [(String, String)] = []
    let player = try Player(PCMFormat(rate: 48000, channels: 1), output) { event in
      if event["type"] as? String == "marked" { marks.append((event["mark"] as! String, event["outcome"] as! String)) }
    }
    let pcm = Data(repeating: 0, count: 200)
    try player.write(pcm)
    try player.mark("first")
    player.clear()
    try player.write(pcm)
    try player.mark("second")
    player.clear()
    var rendered = [Float](repeating: 0, count: 50)
    rt_mixer_render(output.mixer, &rendered, 50)
    player.poll()
    XCTAssertEqual(marks.map { $0.0 }, ["first"])
    XCTAssertEqual(marks[0].1, "cleared")
    rt_mixer_render(output.mixer, &rendered, 1)
    player.poll()
    XCTAssertEqual(marks.map { $0.0 }, ["first", "second"])
    XCTAssertEqual(marks[1].1, "cleared")
    player.close()
  }
}
