// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OCRCli",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "ocrcli", targets: ["OCRCli"])
    ],
    targets: [
        .executableTarget(
            name: "OCRCli",
            linkerSettings: [
                .linkedFramework("Vision"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("AppKit"),
                .linkedFramework("ScreenCaptureKit")
            ]
        )
    ]
)
