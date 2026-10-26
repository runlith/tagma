#include "detector.hpp"
#include "recognizer.hpp"
#include "wire.hpp"

#include "whisper.h"

#include <mutex>

#include <unistd.h>

namespace {

using namespace engine;

thread_local bool printing = false;
std::mutex told;

void log_warnings(ggml_log_level level, const char * text, void *) {
    if (level != GGML_LOG_LEVEL_CONT) printing = level >= GGML_LOG_LEVEL_WARN;
    if (!printing) return;
    std::lock_guard<std::mutex> lock(told);
    std::cerr << text << std::flush;
}

struct Arguments {
    std::string silero;
    std::optional<int> threads;
};

std::optional<Arguments> arguments_of(int argc, char ** argv) {
    Arguments parsed;
    for (int index = 1; index + 1 < argc; index += 2) {
        const std::string name = argv[index];
        const std::string value = argv[index + 1];
        if (name == "--silero" && !value.empty()) parsed.silero = value;
        else if (name == "--threads" && value.find_first_not_of("0123456789") == std::string::npos && !value.empty()) parsed.threads = std::stoi(value);
        else return std::nullopt;
    }
    if (argc % 2 == 0 || parsed.silero.empty() || (parsed.threads && *parsed.threads < 1)) return std::nullopt;
    return parsed;
}

std::optional<std::string> language_of(const json & header) {
    if (!header.contains("language")) return std::nullopt;
    return text_field(header, "language");
}

bool dispatch(Frame & frame, Detector & detector, Recognizer & recognizer) {
    const auto & header = frame.header;
    if (!header.contains("type") || !header["type"].is_string()) throw ProtocolError("frame header has no type");
    const auto type = header["type"].get<std::string>();
    const bool empty = frame.payload.empty();
    using DKind = DetectorCommand::Kind;
    using RKind = RecognizerCommand::Kind;

    if (type == "quit") {
        expect_keys(header, {"type"});
        if (!empty) throw ProtocolError("quit carries an unexpected payload");
        return false;
    }
    if (type == "vad.audio") {
        expect_keys(header, {"type", "stream"});
        if (empty) throw ProtocolError("vad.audio carries no samples");
        if (frame.payload.size() % 2 != 0) throw ProtocolError("PCM payload holds a partial sample");
        detector.submit({DKind::Audio, "", text_field(header, "stream"), std::move(frame.payload)});
        return true;
    }
    if (type == "transcribe") {
        expect_keys(header, {"type", "id"}, {"language"});
        if (empty) throw ProtocolError("transcribe carries no samples");
        recognizer.submit({RKind::Transcribe, text_field(header, "id"), "", language_of(header), samples_of(frame.payload)});
        return true;
    }
    if (!empty) throw ProtocolError(type + " carries an unexpected payload");
    if (type == "vad.open" || type == "vad.end") {
        expect_keys(header, {"type", "id", "stream"});
        detector.submit({type == "vad.open" ? DKind::Open : DKind::End, text_field(header, "id"), text_field(header, "stream"), {}});
    } else if (type == "vad.reset" || type == "vad.close") {
        expect_keys(header, {"type", "stream"});
        detector.submit({type == "vad.reset" ? DKind::Reset : DKind::Close, "", text_field(header, "stream"), {}});
    } else if (type == "load") {
        expect_keys(header, {"type", "id", "path"});
        recognizer.submit({RKind::Load, text_field(header, "id"), text_field(header, "path"), std::nullopt, {}});
    } else if (type == "unload") {
        expect_keys(header, {"type", "id"});
        recognizer.submit({RKind::Unload, text_field(header, "id"), "", std::nullopt, {}});
    } else if (type == "cancel") {
        expect_keys(header, {"type", "id"});
        recognizer.cancel(text_field(header, "id"));
    } else {
        throw ProtocolError("unknown message type " + type);
    }
    return true;
}

}

int main(int argc, char ** argv) {
    whisper_log_set(log_warnings, nullptr);
    Writer writer;
    const auto arguments = arguments_of(argc, argv);
    if (!arguments) {
        writer.error(json::object(), "invocation", "usage: whisper-engine --silero <path> [--threads <count>]");
        return 2;
    }

    Detector detector(writer, arguments->silero);
    std::string failure;
    if (!detector.probe(failure)) {
        writer.error(json::object(), "detector-unavailable", failure);
        return 1;
    }
    Recognizer recognizer(writer, arguments->silero, arguments->threads);
    detector.start();
    recognizer.start();
    writer.send({
        {"type", "ready"},
        {"pid", static_cast<std::uint64_t>(getpid())},
        {"rate", kSampleRate},
        {"window", kWindow},
    });

    int code = 0;
    try {
        while (auto frame = read_frame(std::cin)) {
            if (!dispatch(*frame, detector, recognizer)) break;
        }
    } catch (const std::exception & error) {
        writer.error(json::object(), "protocol-error", error.what());
        code = 2;
    }

    recognizer.stop();
    detector.stop();
    return code;
}
