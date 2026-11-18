// Run from the repository root: swift scripts/make-macos-icon.swift
// Package the existing artwork with Dock padding; do not rescale the source asset in place.
import AppKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let icons = root.appendingPathComponent("packages/desktop/src-tauri/icons")
let source = icons.appendingPathComponent("icon-macos-squircle.png")
guard let image = NSImage(contentsOf: source),
      let artwork = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fatalError("Cannot read macOS icon artwork")
}
let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("visink-icon-\(UUID().uuidString)")
let iconset = temporary.appendingPathComponent("Visink.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }
let sizes = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]
for (points, scale) in sizes {
    let pixels = points * scale
    // 96px margins in the 1024px representation: visual size matches nearby Dock icons.
    let inset = CGFloat(pixels) * 96 / 1024
    guard let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
                                  bytesPerRow: pixels * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        fatalError("Cannot create icon context")
    }
    context.clear(CGRect(x: 0, y: 0, width: pixels, height: pixels))
    context.interpolationQuality = .high
    context.draw(artwork, in: CGRect(x: inset, y: inset, width: CGFloat(pixels) - 2 * inset, height: CGFloat(pixels) - 2 * inset))
    guard let rendered = context.makeImage(),
          let png = NSBitmapImageRep(cgImage: rendered).representation(using: .png, properties: [:]) else {
        fatalError("Cannot encode icon")
    }
    // Every representation must retain transparent outer margins.
    let bytes = context.data!.assumingMemoryBound(to: UInt8.self)
    for x in 0..<pixels {
        assert(bytes[x * 4 + 3] == 0 && bytes[((pixels - 1) * pixels + x) * 4 + 3] == 0)
        assert(bytes[(x * pixels) * 4 + 3] == 0 && bytes[(x * pixels + pixels - 1) * 4 + 3] == 0)
    }
    let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
    try png.write(to: iconset.appendingPathComponent(name))
}
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["--convert", "icns", "--output", icons.appendingPathComponent("icon.icns").path, iconset.path]
try task.run()
task.waitUntilExit()
guard task.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Rebuilt icon.icns: 10 representations, 81.25% artwork size, transparent margins verified.")
