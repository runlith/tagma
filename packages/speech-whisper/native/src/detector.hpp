#pragma once

#include "wire.hpp"

#include <map>
#include <thread>

struct whisper_vad_context;

namespace engine {

constexpr int kWindow = 512;

struct DetectorCommand {
    enum class Kind { Open, Audio, Reset, End, Close };
    Kind kind;
    std::string id;
    std::string stream;
    std::vector<std::uint8_t> pcm;
};

class Detector {
public:
    Detector(Writer & writer, std::string silero_path);
    ~Detector();

    bool probe(std::string & failure);
    void start();
    void submit(DetectorCommand command);
    void stop();

private:
    struct Stream {
        whisper_vad_context * context = nullptr;
        std::vector<float> pending;
        std::size_t start = 0;
        std::uint64_t at = 0;

        std::size_t held() const { return pending.size() - start; }
        void take(std::size_t count);
        void append(const std::vector<std::uint8_t> & pcm);
        void clear();
    };

    whisper_vad_context * open_context() const;
    void run();
    void handle(DetectorCommand & command);
    bool infer(const std::string & name, Stream & stream, std::size_t count);

    Writer & writer_;
    std::string silero_path_;
    Inbox<DetectorCommand> inbox_;
    std::map<std::string, Stream> streams_;
    std::thread thread_;
};

}
