#!/usr/bin/env swift
import CoreGraphics
import Foundation

let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []

func jsonString(_ value: String) -> String {
  let data = try! JSONSerialization.data(withJSONObject: [value], options: [])
  let array = String(data: data, encoding: .utf8)!
  return String(array.dropFirst().dropLast())
}

for window in windows {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  let title = window[kCGWindowName as String] as? String ?? ""
  guard owner == "Antigravity", title.localizedCaseInsensitiveContains("Settings") else { continue }
  guard let id = window[kCGWindowNumber as String] as? UInt32 else { continue }

  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let x = bounds["X"] as? Double ?? 0
  let y = bounds["Y"] as? Double ?? 0
  let width = bounds["Width"] as? Double ?? 0
  let height = bounds["Height"] as? Double ?? 0
  guard width > 300, height > 300 else { continue }

  print("{\"id\":\(id),\"title\":\(jsonString(title)),\"x\":\(x),\"y\":\(y),\"width\":\(width),\"height\":\(height)}")
  exit(0)
}

exit(1)
