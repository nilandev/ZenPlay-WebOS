// Renders the mock server's demo video: an original, text-free animated
// scene (a sunset over drifting mountain ridges) drawn frame by frame with
// CoreGraphics and encoded with AVFoundation — no footage, no third-party
// content, nothing to install beyond the Xcode command line tools.
//
//   swift make-video.swift        (from mock-xtream/, or `npm run make-video`)
//
// Writes into media/:
//   movie.mp4          — H.264, progressive (moov first), for films, episodes and catch-up
//   hls/init.mp4       — fMP4 HLS init segment, for live channels
//   hls/segN.m4s       — fMP4 HLS media segments
//   hls/segments.json  — each segment's duration, read by server.mjs to build a looping live playlist

import AVFoundation
import CoreGraphics
import Foundation
import UniformTypeIdentifiers

let width = 1920
let height = 1080
let fps: Int32 = 30
let movieSeconds = 90
let liveSeconds = 60
let segmentSeconds = 4.0

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("media")
let hlsDir = root.appendingPathComponent("hls")
try? FileManager.default.removeItem(at: root)
try FileManager.default.createDirectory(at: hlsDir, withIntermediateDirectories: true)

// --- The scene -------------------------------------------------------------------

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: r, green: g, blue: b, alpha: a)
}

func mix(_ a: [CGFloat], _ b: [CGFloat], _ t: CGFloat) -> CGColor {
  color(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)
}

/** A ridge line: a sum of sines, so it's smooth, varied and scrolls seamlessly. */
func ridge(_ x: CGFloat, seed: CGFloat) -> CGFloat {
  sin(x * 0.0021 + seed) * 70 + sin(x * 0.0047 + seed * 2.3) * 38 + sin(x * 0.0113 + seed * 0.7) * 14
}

/** Draws frame `t` (seconds). The sky drifts from dusk gold to evening violet over a 60s cycle and back. */
func draw(_ ctx: CGContext, t: Double) {
  let w = CGFloat(width)
  let h = CGFloat(height)
  let phase = CGFloat((1 - cos(t / 60 * 2 * .pi)) / 2) // 0 → 1 → 0 every 60s

  // Sky (CoreGraphics' origin is bottom-left).
  let skyTop = mix([0.16, 0.20, 0.45], [0.10, 0.07, 0.25], phase)
  let skyMid = mix([0.93, 0.52, 0.36], [0.62, 0.30, 0.50], phase)
  let skyLow = mix([1.00, 0.80, 0.45], [0.95, 0.55, 0.40], phase)
  let sky = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [skyLow, skyMid, skyTop] as CFArray, locations: [0.25, 0.55, 1])!
  ctx.drawLinearGradient(sky, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: h), options: [])

  // Sun: slowly sinking, with a soft glow.
  let sunY = h * 0.52 - CGFloat(t) * 1.2
  let sunX = w * 0.62
  let glow = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [color(1, 0.93, 0.7, 0.55), color(1, 0.8, 0.5, 0)] as CFArray, locations: [0, 1])!
  ctx.drawRadialGradient(glow, startCenter: CGPoint(x: sunX, y: sunY), startRadius: 0, endCenter: CGPoint(x: sunX, y: sunY), endRadius: 420, options: [])
  ctx.setFillColor(color(1, 0.95, 0.78))
  ctx.fillEllipse(in: CGRect(x: sunX - 95, y: sunY - 95, width: 190, height: 190))

  // Drifting haze bands.
  for i in 0..<3 {
    let y = h * (0.42 + CGFloat(i) * 0.08)
    let x = CGFloat((t * Double(18 + i * 9)).truncatingRemainder(dividingBy: Double(w * 2))) - w * 0.6
    ctx.setFillColor(color(1, 0.9, 0.85, 0.07))
    ctx.fillEllipse(in: CGRect(x: x, y: y, width: w * 0.8, height: 60))
  }

  // Mountain layers, far to near: darker and faster (parallax).
  let layers: [(base: CGFloat, speed: CGFloat, seed: CGFloat, far: [CGFloat], near: [CGFloat])] = [
    (0.40, 6, 1.1, [0.55, 0.36, 0.48], [0.40, 0.26, 0.42]),
    (0.30, 14, 4.2, [0.36, 0.22, 0.36], [0.26, 0.16, 0.30]),
    (0.19, 28, 7.9, [0.20, 0.12, 0.22], [0.14, 0.09, 0.18]),
    (0.09, 50, 2.6, [0.09, 0.06, 0.12], [0.06, 0.04, 0.09]),
  ]
  for layer in layers {
    let path = CGMutablePath()
    path.move(to: CGPoint(x: 0, y: 0))
    var x: CGFloat = 0
    while x <= w {
      path.addLine(to: CGPoint(x: x, y: h * layer.base + ridge(x + CGFloat(t) * layer.speed, seed: layer.seed)))
      x += 8
    }
    path.addLine(to: CGPoint(x: w, y: 0))
    path.closeSubpath()
    ctx.addPath(path)
    ctx.setFillColor(mix(layer.far, layer.near, phase))
    ctx.fillPath()
  }

  // Birds: a small flock crossing slowly.
  ctx.setStrokeColor(color(0.12, 0.08, 0.15, 0.8))
  ctx.setLineWidth(3)
  for i in 0..<5 {
    let bx = CGFloat((t * 40 + Double(i) * 55).truncatingRemainder(dividingBy: Double(w + 400))) - 200
    let by = h * 0.68 + CGFloat(i % 2) * 30 + CGFloat(sin(t * 1.3 + Double(i))) * 10
    let flap = CGFloat(sin(t * 8 + Double(i))) * 8
    ctx.move(to: CGPoint(x: bx - 16, y: by + flap))
    ctx.addQuadCurve(to: CGPoint(x: bx, y: by), control: CGPoint(x: bx - 8, y: by + 4))
    ctx.addQuadCurve(to: CGPoint(x: bx + 16, y: by + flap), control: CGPoint(x: bx + 8, y: by + 4))
    ctx.strokePath()
  }
}

// --- Encoding ----------------------------------------------------------------------

func videoInput(bitrate: Int) -> AVAssetWriterInput {
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
      AVVideoAverageBitRateKey: bitrate,
      AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      AVVideoAllowFrameReorderingKey: false,
    ],
  ])
  input.expectsMediaDataInRealTime = false
  return input
}

func render(into writer: AVAssetWriter, input: AVAssetWriterInput, seconds: Int) {
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
  writer.add(input)
  guard writer.startWriting() else { fatalError("Couldn't start writing: \(String(describing: writer.error))") }
  writer.startSession(atSourceTime: .zero)

  let frames = seconds * Int(fps)
  for frame in 0..<frames {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    guard let pixels = buffer else { fatalError("No pixel buffer") }
    CVPixelBufferLockBaseAddress(pixels, [])
    let ctx = CGContext(
      data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    draw(ctx, t: Double(frame) / Double(fps))
    CVPixelBufferUnlockBaseAddress(pixels, [])
    adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
    if frame % (Int(fps) * 10) == 0 { print("  \(frame / Int(fps))s / \(seconds)s") }
  }
  input.markAsFinished()
  let done = DispatchSemaphore(value: 0)
  writer.finishWriting { done.signal() }
  done.wait()
  if writer.status != .completed { fatalError("Encoding failed: \(String(describing: writer.error))") }
}

// Movie: a plain MP4 with the index up front, so playback starts before the whole file arrives.
print("Rendering movie.mp4 (\(movieSeconds)s)…")
let movieWriter = try AVAssetWriter(outputURL: root.appendingPathComponent("movie.mp4"), fileType: .mp4)
movieWriter.shouldOptimizeForNetworkUse = true
render(into: movieWriter, input: videoInput(bitrate: 3_500_000), seconds: movieSeconds)

// Live: fMP4 HLS segments, collected through the writer's delegate.
final class SegmentCollector: NSObject, AVAssetWriterDelegate {
  var durations: [Double] = []
  func assetWriter(_ writer: AVAssetWriter, didOutputSegmentData data: Data, segmentType: AVAssetSegmentType, segmentReport: AVAssetSegmentReport?) {
    if segmentType == .initialization {
      try! data.write(to: hlsDir.appendingPathComponent("init.mp4"))
      return
    }
    try! data.write(to: hlsDir.appendingPathComponent("seg\(durations.count).m4s"))
    durations.append(segmentReport?.trackReports.first.map { CMTimeGetSeconds($0.duration) } ?? segmentSeconds)
  }
}

print("Rendering live HLS segments (\(liveSeconds)s)…")
let collector = SegmentCollector()
let liveWriter = AVAssetWriter(contentType: UTType(AVFileType.mp4.rawValue)!)
liveWriter.outputFileTypeProfile = .mpeg4AppleHLS
liveWriter.preferredOutputSegmentInterval = CMTime(seconds: segmentSeconds, preferredTimescale: 1)
liveWriter.initialSegmentStartTime = .zero
liveWriter.delegate = collector
render(into: liveWriter, input: videoInput(bitrate: 3_500_000), seconds: liveSeconds)

let manifest = try JSONSerialization.data(withJSONObject: ["durations": collector.durations], options: [.prettyPrinted])
try manifest.write(to: hlsDir.appendingPathComponent("segments.json"))
print("Done: media/movie.mp4 and \(collector.durations.count) live segments in media/hls/")
