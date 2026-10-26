#include "detector.hpp"

#include "whisper.h"

namespace engine {

Detector::Detector(Writer & writer, std::string silero_path)
    : writer_(writer), silero_path_(std::move(silero_path)) {}

Detector::~Detector() {
    stop();
}

whisper_vad_context * Detector::open_context() const {
    auto params = whisper_vad_default_context_params();
    params.n_threads = 1;
    params.use_gpu = false;
    return whisper_vad_init_from_file_with_params(silero_path_.c_str(), params);
}

bool Detector::probe(std::string & failure) {
    auto * context = open_context();
    if (!context) {
        failure = "Silero could not be loaded from " + silero_path_ + ".";
        return false;
    }
    std::vector<float> silence(kWindow + 1, 0.0F);
    const bool whole = whisper_vad_detect_speech(context, silence.data(), kWindow) && whisper_vad_n_probs(context) == 1;
    const bool split = whisper_vad_detect_speech(context, silence.data(), kWindow + 1) && whisper_vad_n_probs(context) == 2;
    whisper_vad_free(context);
    if (!whole || !split) {
        failure = "Silero does not compute one probability per " + std::to_string(kWindow) + " samples.";
        return false;
    }
    return true;
}

void Detector::start() {
    thread_ = std::thread([this] { run(); });
}

void Detector::submit(DetectorCommand command) {
    inbox_.push(std::move(command));
}

void Detector::stop() {
    inbox_.close();
    if (thread_.joinable()) thread_.join();
    for (auto & [_, stream] : streams_) {
        if (stream.context) whisper_vad_free(stream.context);
    }
    streams_.clear();
}

void Detector::run() {
    while (auto command = inbox_.take()) handle(*command);
}

void Detector::Stream::take(std::size_t count) {
    start += count;
    at += count;
    if (start >= 16 * kWindow) {
        pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(start));
        start = 0;
    }
}

void Detector::Stream::append(const std::vector<std::uint8_t> & pcm) {
    pending.reserve(pending.size() + pcm.size() / 2);
    for (std::size_t index = 0; index + 1 < pcm.size(); index += 2) {
        const auto bits = static_cast<std::uint16_t>(pcm[index] | (pcm[index + 1] << 8U));
        pending.push_back(static_cast<float>(static_cast<std::int16_t>(bits)) / 32768.0F);
    }
}

void Detector::Stream::clear() {
    at += held();
    pending.clear();
    start = 0;
}

bool Detector::infer(const std::string & name, Stream & stream, std::size_t count) {
    if (!whisper_vad_detect_speech_no_reset(stream.context, stream.pending.data() + stream.start, static_cast<int>(count))) {
        whisper_vad_free(stream.context);
        streams_.erase(name);
        return false;
    }
    const auto * values = whisper_vad_probs(stream.context);
    const auto n = whisper_vad_n_probs(stream.context);
    json probs = json::array();
    for (int index = 0; index < n; ++index) probs.push_back(values[index]);
    writer_.send({
        {"type", "vad.probs"},
        {"stream", name},
        {"at", stream.at},
        {"samples", count},
        {"probs", std::move(probs)},
    });
    stream.take(count);
    return true;
}

void Detector::handle(DetectorCommand & command) {
    using Kind = DetectorCommand::Kind;
    if (command.kind == Kind::Open) {
        if (streams_.count(command.stream) != 0) {
            writer_.error({{"id", command.id}, {"stream", command.stream}}, "stream-exists", "The detector stream is already open.");
            return;
        }
        auto * context = open_context();
        if (!context) {
            writer_.error({{"id", command.id}, {"stream", command.stream}}, "detector-unavailable", "Silero could not be loaded.");
            return;
        }
        streams_[command.stream].context = context;
        writer_.send({{"type", "vad.opened"}, {"id", command.id}, {"stream", command.stream}});
        return;
    }

    auto found = streams_.find(command.stream);
    if (found == streams_.end()) {
        writer_.error(command.id.empty() ? json{{"stream", command.stream}} : json{{"id", command.id}, {"stream", command.stream}},
            "stream-unknown", "The detector stream is not open.");
        return;
    }
    auto & stream = found->second;

    switch (command.kind) {
    case Kind::Audio: {
        stream.append(command.pcm);
        const auto whole = stream.held() / kWindow * kWindow;
        if (whole > 0 && !infer(command.stream, stream, whole)) {
            writer_.error({{"stream", command.stream}}, "detector-failed", "Silero inference failed.");
        }
        return;
    }
    case Kind::Reset:
        stream.clear();
        whisper_vad_reset_state(stream.context);
        return;
    case Kind::End: {
        const auto name = command.stream;
        if (stream.held() > 0 && !infer(name, stream, stream.held())) {
            writer_.error({{"id", command.id}, {"stream", name}}, "detector-failed", "Silero inference failed on the tail.");
            return;
        }
        whisper_vad_reset_state(streams_[name].context);
        writer_.send({{"type", "vad.ended"}, {"id", command.id}, {"stream", name}});
        return;
    }
    case Kind::Close:
        whisper_vad_free(stream.context);
        streams_.erase(found);
        return;
    case Kind::Open:
        return;
    }
}

}
