// Face detection via the macOS Vision framework. No installs, no model files —
// Vision ships with the OS. Takes image paths, prints one JSON line per image
// with face boxes in TOP-LEFT normalised coordinates (Vision reports
// bottom-left, so y is flipped here once, at the source).
import Foundation
import Vision
import AppKit

struct Box: Codable { let x: Double, y: Double, w: Double, h: Double }
struct Result: Codable { let file: String; let faces: [Box] }

var out: [Result] = []
for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        out.append(Result(file: path, faces: []))
        continue
    }
    let req = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { }
    let faces = (req.results ?? []).map { obs -> Box in
        let b = obs.boundingBox
        return Box(x: b.minX, y: 1.0 - b.maxY, w: b.width, h: b.height)
    }
    out.append(Result(file: path, faces: faces))
}
let data = try JSONEncoder().encode(out)
print(String(data: data, encoding: .utf8)!)
