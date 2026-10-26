cmake_minimum_required(VERSION 3.24)
project(whisper-engine LANGUAGES C CXX)

include(FetchContent)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_METAL ON CACHE BOOL "" FORCE)
set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  whisper
  URL https://github.com/ggerganov/whisper.cpp/archive/080bbbe85230f624f0b52127f1ae1218247989f9.tar.gz
  URL_HASH SHA256=cb27b23a357642bcd7189ad24d9c8b770ba49f7a49216b899798d52c02f8beaf
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  PATCH_COMMAND patch -p1 -i ${CMAKE_CURRENT_SOURCE_DIR}/patches/log-once.patch
)
FetchContent_MakeAvailable(whisper)

find_package(Threads REQUIRED)

add_executable(whisper-engine src/main.cpp src/detector.cpp src/recognizer.cpp)
target_compile_features(whisper-engine PRIVATE cxx_std_17)
target_include_directories(whisper-engine PRIVATE ${whisper_SOURCE_DIR}/examples)
target_link_libraries(whisper-engine PRIVATE whisper Threads::Threads)
set_target_properties(
  whisper-engine
  PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
