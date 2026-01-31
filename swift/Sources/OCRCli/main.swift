import Foundation
import AppKit
import CoreGraphics
import Vision
import ScreenCaptureKit

// MARK: - JSON Protocol Models

struct Command: Codable {
    let action: String
    let languages: [String]?
    let saveTo: String?
}

struct Response: Codable {
    let type: String
    let success: Bool
    let data: ResponseData?
    let error: String?
}

enum ResponseData: Codable {
    case windowSelected(WindowSelectedData)
    case ocr(OCRData)
    case ready(ReadyData)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .windowSelected(let data): try container.encode(data)
        case .ocr(let data): try container.encode(data)
        case .ready(let data): try container.encode(data)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let data = try? container.decode(WindowSelectedData.self) {
            self = .windowSelected(data)
        } else if let data = try? container.decode(OCRData.self) {
            self = .ocr(data)
        } else if let data = try? container.decode(ReadyData.self) {
            self = .ready(data)
        } else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Unknown data type"))
        }
    }
}

struct ReadyData: Codable {
    let version: String
}

struct WindowSelectedData: Codable {
    let windowId: UInt32?
    let appName: String?
    let windowTitle: String?
    let bounds: WindowBounds?
}

struct WindowBounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRData: Codable {
    let imageWidth: Int
    let imageHeight: Int
    let observations: [TextObservation]
    let bounds: WindowBounds?
}

struct TextObservation: Codable {
    let text: String
    let confidence: Float
    let boundingBox: NormalizedRect
    let topLeft: NormalizedPoint
    let topRight: NormalizedPoint
    let bottomRight: NormalizedPoint
    let bottomLeft: NormalizedPoint
}

struct NormalizedRect: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct NormalizedPoint: Codable {
    let x: Double
    let y: Double
}

// MARK: - Output Helper

func sendResponse(_ response: Response) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let jsonData = try? encoder.encode(response),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
        fflush(stdout)
    }
}

func sendError(type: String, message: String) {
    sendResponse(Response(type: type, success: false, data: nil, error: message))
}

func sendSuccess(type: String, data: ResponseData) {
    sendResponse(Response(type: type, success: true, data: data, error: nil))
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate, SCContentSharingPickerObserver {
    var currentFilter: SCContentFilter?
    var currentWindowID: CGWindowID?
    var pendingCommand: Command?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide from dock
        NSApp.setActivationPolicy(.accessory)

        // Setup picker observer
        let picker = SCContentSharingPicker.shared
        picker.add(self)

        // Send ready message
        sendSuccess(type: "ready", data: .ready(ReadyData(version: "1.0.0")))

        // Start reading stdin in background
        DispatchQueue.global(qos: .userInitiated).async {
            self.readStdin()
        }
    }

    func readStdin() {
        while let line = readLine() {
            guard !line.isEmpty else { continue }

            guard let data = line.data(using: .utf8),
                  let command = try? JSONDecoder().decode(Command.self, from: data) else {
                DispatchQueue.main.async {
                    sendError(type: "error", message: "Invalid JSON command")
                }
                continue
            }

            DispatchQueue.main.async {
                self.handleCommand(command)
            }
        }

        // stdin closed, exit
        DispatchQueue.main.async {
            NSApp.terminate(nil)
        }
    }

    func handleCommand(_ command: Command) {
        switch command.action {
        case "pick":
            showPicker()

        case "scan":
            pendingCommand = command
            if currentFilter != nil {
                executeScan(command)
            } else {
                showPicker()
            }

        case "quit":
            NSApp.terminate(nil)

        default:
            sendError(type: "error", message: "Unknown action: \(command.action)")
        }
    }

    // MARK: - Window Bounds Helper

    func getCurrentWindowBounds() -> WindowBounds? {
        guard let windowID = currentWindowID else { return nil }

        let windowList = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowID) as? [[String: Any]]
        guard let windowInfo = windowList?.first,
              let boundsDict = windowInfo[kCGWindowBounds as String] as? [String: Any],
              let x = boundsDict["X"] as? CGFloat,
              let y = boundsDict["Y"] as? CGFloat,
              let width = boundsDict["Width"] as? CGFloat,
              let height = boundsDict["Height"] as? CGFloat else {
            return nil
        }

        return WindowBounds(x: Double(x), y: Double(y), width: Double(width), height: Double(height))
    }

    func findWindowID(matching rect: CGRect) -> CGWindowID? {
        // Get all on-screen windows
        guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        for windowInfo in windowList {
            guard let boundsDict = windowInfo[kCGWindowBounds as String] as? [String: Any],
                  let x = boundsDict["X"] as? CGFloat,
                  let y = boundsDict["Y"] as? CGFloat,
                  let width = boundsDict["Width"] as? CGFloat,
                  let height = boundsDict["Height"] as? CGFloat,
                  let windowID = windowInfo[kCGWindowNumber as String] as? CGWindowID else {
                continue
            }

            // Match by position and size (allowing small tolerance for rounding)
            let tolerance: CGFloat = 2.0
            if abs(x - rect.origin.x) < tolerance &&
               abs(y - rect.origin.y) < tolerance &&
               abs(width - rect.size.width) < tolerance &&
               abs(height - rect.size.height) < tolerance {
                return windowID
            }
        }

        return nil
    }

    // MARK: - Window Picker

    func showPicker() {
        let picker = SCContentSharingPicker.shared

        var config = SCContentSharingPickerConfiguration()
        config.allowedPickerModes = [.singleWindow]
        picker.defaultConfiguration = config

        picker.isActive = true
        picker.present(using: .window)
    }

    // MARK: - SCContentSharingPickerObserver

    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        sendError(type: "pick", message: "User cancelled window selection")
        pendingCommand = nil
    }

    func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        sendError(type: "pick", message: "Picker failed to start: \(error.localizedDescription)")
        pendingCommand = nil
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        self.currentFilter = filter

        // Use the filter's contentRect for initial bounds
        let rect = filter.contentRect

        // Find and store the window ID for tracking position changes
        self.currentWindowID = findWindowID(matching: rect)

        let windowData = WindowSelectedData(
            windowId: currentWindowID.map { UInt32($0) },
            appName: nil,
            windowTitle: nil,
            bounds: WindowBounds(
                x: rect.origin.x,
                y: rect.origin.y,
                width: rect.size.width,
                height: rect.size.height
            )
        )

        sendSuccess(type: "pick", data: .windowSelected(windowData))

        if let pending = self.pendingCommand {
            self.executeScan(pending)
            self.pendingCommand = nil
        }
    }

    // MARK: - Scan (Capture + OCR)

    func executeScan(_ command: Command) {
        guard let filter = currentFilter else {
            sendError(type: "scan", message: "No window selected")
            return
        }

        Task {
            do {
                let config = SCStreamConfiguration()

                // Use the filter's content rect for dimensions
                let rect = filter.contentRect
                let scale: CGFloat = filter.pointPixelScale > 0 ? CGFloat(filter.pointPixelScale) : (NSScreen.main?.backingScaleFactor ?? 2.0)
                config.width = Int(rect.width * scale)
                config.height = Int(rect.height * scale)
                config.scalesToFit = false
                config.captureResolution = .best
                config.showsCursor = false

                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

                if let savePath = command.saveTo {
                    let bitmapRep = NSBitmapImageRep(cgImage: image)
                    if let pngData = bitmapRep.representation(using: .png, properties: [:]) {
                        try? pngData.write(to: URL(fileURLWithPath: savePath))
                    }
                }

                let languages = command.languages ?? ["ja", "en"]
                // Get fresh window bounds (in case window moved since selection)
                let currentBounds = await MainActor.run {
                    self.getCurrentWindowBounds() ?? WindowBounds(
                        x: rect.origin.x,
                        y: rect.origin.y,
                        width: rect.size.width,
                        height: rect.size.height
                    )
                }
                await MainActor.run {
                    self.performOCR(cgImage: image, languages: languages, bounds: currentBounds)
                }
            } catch {
                await MainActor.run {
                    sendError(type: "scan", message: "Failed: \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - OCR

    func performOCR(cgImage: CGImage, languages: [String], bounds: WindowBounds) {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = languages
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

        do {
            try handler.perform([request])
        } catch {
            sendError(type: "scan", message: "OCR failed: \(error.localizedDescription)")
            return
        }

        guard let results = request.results else {
            sendSuccess(type: "scan", data: .ocr(OCRData(imageWidth: cgImage.width, imageHeight: cgImage.height, observations: [], bounds: bounds)))
            return
        }

        var observations: [TextObservation] = []

        for observation in results {
            guard let topCandidate = observation.topCandidates(1).first else {
                continue
            }

            let boundingBox = observation.boundingBox

            let textObs = TextObservation(
                text: topCandidate.string,
                confidence: topCandidate.confidence,
                boundingBox: NormalizedRect(
                    x: boundingBox.origin.x,
                    y: boundingBox.origin.y,
                    width: boundingBox.width,
                    height: boundingBox.height
                ),
                topLeft: NormalizedPoint(x: observation.topLeft.x, y: observation.topLeft.y),
                topRight: NormalizedPoint(x: observation.topRight.x, y: observation.topRight.y),
                bottomRight: NormalizedPoint(x: observation.bottomRight.x, y: observation.bottomRight.y),
                bottomLeft: NormalizedPoint(x: observation.bottomLeft.x, y: observation.bottomLeft.y)
            )
            observations.append(textObs)
        }

        sendSuccess(type: "scan", data: .ocr(OCRData(imageWidth: cgImage.width, imageHeight: cgImage.height, observations: observations, bounds: bounds)))
    }
}

// MARK: - Main Entry Point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
