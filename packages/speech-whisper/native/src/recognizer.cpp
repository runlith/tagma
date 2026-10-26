#include "recognizer.hpp"

#include "whisper.h"

#include <filesystem>

#ifdef __APPLE__
#include <sys/sysctl.h>
#endif

namespace engine {

namespace {

int inference_threads() {
#ifdef __APPLE__
    int performance = 0;
    std::size_t size = sizeof(performance);
    if (sysctlbyname("hw.perflevel0.physicalcpu", &performance, &size, nullptr, 0) == 0 && performance > 0) {
        return performance;
    }
#endif
    const auto logical = static_cast<int>(std::thread::hardware_concurrency());
    if (logical > 2 && logical % 2 == 0) return logical / 2;
    return logical > 0 ? logical : 1;
}

constexpr float kSpeech = 0.5F;

}

Recognizer::Recognizer(Writer & writer, std::string silero_path, std::optional<int> threads)
    : writer_(writer), silero_path_(std::move(silero_path)), threads_(threads.value_or(inference_threads())) {}

std::optional<bool> Recognizer::speaks(const std::vector<float> & samples) {
    if (!gate_) {
        auto params = whisper_vad_default_context_params();
        params.n_threads = 1;
        params.use_gpu = false;
        gate_ = whisper_vad_init_from_file_with_params(silero_path_.c_str(), params);
        if (!gate_) return std::nullopt;
    }
    if (!whisper_vad_detect_speech(gate_, samples.data(), static_cast<int>(samples.size()))) return std::nullopt;
    const auto * probs = whisper_vad_probs(gate_);
    const auto count = whisper_vad_n_probs(gate_);
    for (int index = 0; index < count; ++index) {
        if (probs[index] >= kSpeech) return true;
    }
    return false;
}

Recognizer::~Recognizer() {
    stop();
}

void Recognizer::start() {
    thread_ = std::thread([this] { run(); });
}

void Recognizer::submit(RecognizerCommand command) {
    if (command.kind == RecognizerCommand::Kind::Transcribe) {
        std::lock_guard<std::mutex> lock(mutex_);
        queued_.insert(command.id);
    }
    inbox_.push(std::move(command));
}

void Recognizer::cancel(const std::string & id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (active_ == id) abort_.store(true);
    else if (queued_.count(id) != 0) cancelled_.insert(id);
}

void Recognizer::stop() {
    abort_.store(true);
    inbox_.close();
    if (thread_.joinable()) thread_.join();
    if (context_) {
        whisper_free(context_);
        context_ = nullptr;
    }
    if (gate_) {
        whisper_vad_free(gate_);
        gate_ = nullptr;
    }
}

void Recognizer::run() {
    while (auto command = inbox_.take()) {
        switch (command->kind) {
        case RecognizerCommand::Kind::Load: load(*command); break;
        case RecognizerCommand::Kind::Unload: unload(*command); break;
        case RecognizerCommand::Kind::Transcribe: transcribe(*command); break;
        }
    }
}

void Recognizer::load(const RecognizerCommand & command) {
    const std::filesystem::path path(command.path);
    if (!path.is_absolute() || !std::filesystem::is_regular_file(path)) {
        writer_.error({{"id", command.id}}, "model-missing", "The model path is not an absolute regular file.");
        return;
    }
    if (context_) {
        whisper_free(context_);
        context_ = nullptr;
    }
    auto params = whisper_context_default_params();
    params.use_gpu = true;
    params.flash_attn = true;
    params.gpu_device = 0;
    context_ = whisper_init_from_file_with_params(command.path.c_str(), params);
    if (!context_) {
        writer_.error({{"id", command.id}}, "model-load-failed", "whisper.cpp could not load the model.");
        return;
    }
    writer_.send({{"type", "loaded"}, {"id", command.id}});
}

void Recognizer::unload(const RecognizerCommand & command) {
    if (context_) {
        whisper_free(context_);
        context_ = nullptr;
    }
    writer_.send({{"type", "unloaded"}, {"id", command.id}});
}

bool Recognizer::admit(const std::string & id) {
    std::lock_guard<std::mutex> lock(mutex_);
    queued_.erase(id);
    if (cancelled_.erase(id) != 0) return false;
    active_ = id;
    abort_.store(false);
    return true;
}

void Recognizer::settle() {
    std::lock_guard<std::mutex> lock(mutex_);
    active_.clear();
}

void Recognizer::transcribe(const RecognizerCommand & command) {
    if (!admit(command.id)) {
        writer_.send({{"type", "cancelled"}, {"id", command.id}});
        return;
    }
    if (!context_) {
        settle();
        writer_.error({{"id", command.id}}, "model-missing", "No Whisper model is loaded.");
        return;
    }
    if (command.language && whisper_lang_id(command.language->c_str()) < 0) {
        settle();
        writer_.error({{"id", command.id}}, "language-unsupported", "Whisper does not know language " + *command.language + ".");
        return;
    }

    const auto speech = speaks(command.samples);
    if (abort_.load()) {
        settle();
        writer_.send({{"type", "cancelled"}, {"id", command.id}});
        return;
    }
    if (!speech) {
        settle();
        writer_.error({{"id", command.id}}, "detector-failed", "Silero could not check the clip for speech.");
        return;
    }
    if (!*speech) {
        settle();
        writer_.send({
            {"type", "result"},
            {"id", command.id},
            {"language", command.language ? json(*command.language) : json(nullptr)},
            {"segments", json::array()},
        });
        return;
    }

    auto params = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH);
    params.n_threads = threads_;
    params.beam_search.beam_size = 5;
    params.translate = false;
    params.print_realtime = false;
    params.print_progress = false;
    params.print_special = false;
    params.print_timestamps = false;
    params.no_timestamps = false;
    params.temperature = 0.0F;
    params.temperature_inc = 0.0F;
    params.no_context = true;
    params.suppress_nst = true;
    params.detect_language = false;
    const std::string language = command.language.value_or("auto");
    params.language = language.c_str();
    params.abort_callback = [](void * data) { return static_cast<std::atomic<bool> *>(data)->load(); };
    params.abort_callback_user_data = &abort_;

    const auto status = whisper_full(context_, params, command.samples.data(), static_cast<int>(command.samples.size()));
    const bool aborted = abort_.load();
    settle();

    if (aborted) {
        writer_.send({{"type", "cancelled"}, {"id", command.id}});
        return;
    }
    if (status == -3 && !command.language) {
        writer_.error({{"id", command.id}}, "language-undetected", "Whisper could not detect the language.");
        return;
    }
    if (status != 0) {
        writer_.error({{"id", command.id}}, "inference-failed", "whisper.cpp inference failed with status " + std::to_string(status) + ".");
        return;
    }

    const auto language_id = whisper_full_lang_id(context_);
    if (language_id < 0) {
        writer_.error({{"id", command.id}}, "language-undetected", "Whisper could not detect the language.");
        return;
    }
    json segments = json::array();
    const auto count = whisper_full_n_segments(context_);
    for (int index = 0; index < count; ++index) {
        segments.push_back({
            {"from", whisper_full_get_segment_t0(context_, index) * 10},
            {"to", whisper_full_get_segment_t1(context_, index) * 10},
            {"text", whisper_full_get_segment_text(context_, index)},
        });
    }
    writer_.send({
        {"type", "result"},
        {"id", command.id},
        {"language", whisper_lang_str(language_id)},
        {"segments", std::move(segments)},
    });
}

}
