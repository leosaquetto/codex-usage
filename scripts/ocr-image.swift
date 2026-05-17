#!/usr/bin/env swift
import Foundation
import ImageIO
import Vision

struct TextObservation: Encodable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  fputs("Usage: swift scripts/ocr-image.swift /path/to/image.png\n", stderr)
  exit(2)
}

let url = URL(fileURLWithPath: args[1])
guard
  let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else {
  fputs("Could not read image: \(args[1])\n", stderr)
  exit(1)
}

let imageWidth = Double(image.width)
let imageHeight = Double(image.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
  try handler.perform([request])
} catch {
  fputs("OCR failed: \(error)\n", stderr)
  exit(1)
}

let observations = (request.results ?? []).compactMap { observation -> TextObservation? in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  let box = observation.boundingBox
  return TextObservation(
    text: candidate.string,
    x: box.minX * imageWidth,
    y: (1.0 - box.maxY) * imageHeight,
    width: box.width * imageWidth,
    height: box.height * imageHeight
  )
}

do {
  let data = try JSONEncoder().encode(observations)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
  fputs("Could not encode OCR result: \(error)\n", stderr)
  exit(1)
}
