#pragma once

#include "json.hpp"

#include <condition_variable>
#include <cstdint>
#include <deque>
#include <iostream>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace engine {

using json = nlohmann::ordered_json;

constexpr std::uint32_t kMaxHeaderBytes = 64 * 1024;
constexpr std::uint32_t kMaxPayloadBytes = 64 * 1024 * 1024;
constexpr int kSampleRate = 16000;

class ProtocolError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

struct Frame {
    json header;
    std::vector<std::uint8_t> payload;
};

class Writer {
public:
    void send(const json & message) {
        std::lock_guard<std::mutex> lock(mutex_);
        std::cout << message.dump() << '\n' << std::flush;
    }

    void error(const json & scope, const std::string & code, const std::string & text) {
        json message = {{"type", "error"}};
        for (const auto & [key, value] : scope.items()) message[key] = value;
        message["code"] = code;
        message["message"] = text;
        send(message);
    }

private:
    std::mutex mutex_;
};

template <typename T>
class Inbox {
public:
    void push(T item) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            items_.push_back(std::move(item));
        }
        ready_.notify_one();
    }

    std::optional<T> take() {
        std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [this] { return closed_ || !items_.empty(); });
        if (closed_) return std::nullopt;
        auto item = std::move(items_.front());
        items_.pop_front();
        return item;
    }

    void close() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            closed_ = true;
        }
        ready_.notify_all();
    }

private:
    std::mutex mutex_;
    std::condition_variable ready_;
    std::deque<T> items_;
    bool closed_ = false;
};

inline std::uint32_t read_u32_be(const std::uint8_t * data) {
    return (static_cast<std::uint32_t>(data[0]) << 24U) | (static_cast<std::uint32_t>(data[1]) << 16U) |
           (static_cast<std::uint32_t>(data[2]) << 8U) | static_cast<std::uint32_t>(data[3]);
}

inline bool read_exact(std::istream & input, char * data, std::size_t size) {
    input.read(data, static_cast<std::streamsize>(size));
    return input.gcount() == static_cast<std::streamsize>(size);
}

inline std::optional<Frame> read_frame(std::istream & input) {
    std::uint8_t prefix[8];
    input.read(reinterpret_cast<char *>(prefix), sizeof(prefix));
    if (input.gcount() == 0 && input.eof()) return std::nullopt;
    if (input.gcount() != static_cast<std::streamsize>(sizeof(prefix))) throw ProtocolError("truncated frame prefix");

    const auto header_size = read_u32_be(prefix);
    const auto payload_size = read_u32_be(prefix + 4);
    if (header_size == 0 || header_size > kMaxHeaderBytes) throw ProtocolError("frame header exceeds protocol limit");
    if (payload_size > kMaxPayloadBytes) throw ProtocolError("frame payload exceeds protocol limit");

    std::string header(header_size, '\0');
    if (!read_exact(input, header.data(), header.size())) throw ProtocolError("truncated frame header");
    std::vector<std::uint8_t> payload(payload_size);
    if (payload_size > 0 && !read_exact(input, reinterpret_cast<char *>(payload.data()), payload.size())) {
        throw ProtocolError("truncated frame payload");
    }
    auto parsed = json::parse(header, nullptr, false);
    if (parsed.is_discarded() || !parsed.is_object()) throw ProtocolError("frame header is not a JSON object");
    return Frame{std::move(parsed), std::move(payload)};
}

inline void expect_keys(const json & value, const std::set<std::string> & required, const std::set<std::string> & optional = {}) {
    for (const auto & key : required) {
        if (!value.contains(key)) throw ProtocolError("missing field " + key);
    }
    for (const auto & [key, _] : value.items()) {
        if (required.count(key) == 0 && optional.count(key) == 0) throw ProtocolError("unknown field " + key);
    }
}

inline std::string text_field(const json & value, const std::string & key) {
    if (!value[key].is_string() || value[key].get<std::string>().empty()) {
        throw ProtocolError(key + " must be a non-empty string");
    }
    return value[key].get<std::string>();
}

inline std::vector<float> samples_of(const std::vector<std::uint8_t> & payload) {
    if (payload.size() % 2 != 0) throw ProtocolError("PCM payload holds a partial sample");
    std::vector<float> samples(payload.size() / 2);
    for (std::size_t index = 0; index < samples.size(); ++index) {
        const auto bits = static_cast<std::uint16_t>(payload[index * 2]) |
                          static_cast<std::uint16_t>(static_cast<std::uint16_t>(payload[index * 2 + 1]) << 8U);
        samples[index] = static_cast<float>(static_cast<std::int16_t>(bits)) / 32768.0F;
    }
    return samples;
}

}
