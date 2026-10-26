#pragma once

#include "wire.hpp"

#include <atomic>
#include <thread>

struct whisper_context;
struct whisper_vad_context;

namespace engine {

struct RecognizerCommand {
    enum class Kind { Load, Unload, Transcribe };
    Kind kind;
    std::string id;
    std::string path;
    std::optional<std::string> language;
    std::vector<float> samples;
};

class Recognizer {
public:
    Recognizer(Writer & writer, std::string silero_path, std::optional<int> threads);
    ~Recognizer();

    void start();
    void submit(RecognizerCommand command);
    void cancel(const std::string & id);
    void stop();

private:
    void run();
    void load(const RecognizerCommand & command);
    void unload(const RecognizerCommand & command);
    void transcribe(const RecognizerCommand & command);
    bool admit(const std::string & id);
    void settle();
    std::optional<bool> speaks(const std::vector<float> & samples);

    Writer & writer_;
    const std::string silero_path_;
    const int threads_;
    whisper_vad_context * gate_ = nullptr;
    Inbox<RecognizerCommand> inbox_;
    std::thread thread_;
    whisper_context * context_ = nullptr;
    std::mutex mutex_;
    std::set<std::string> queued_;
    std::set<std::string> cancelled_;
    std::string active_;
    std::atomic<bool> abort_{false};
};

}
