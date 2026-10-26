{
  "targets": [
    {
      "target_name": "window_behavior_native",
      "sources": ["window-behavior-native.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            },
            "link_settings": {
              "libraries": ["-framework Cocoa"]
            }
          }
        ]
      ]
    }
  ]
}
