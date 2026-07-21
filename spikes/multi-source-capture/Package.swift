// swift-tools-version: 6.2
// THROWAWAY SPIKE — see README.md. Not production code.
import PackageDescription

let package = Package(
    name: "capture-spike",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(
            name: "capture-spike",
            path: "Sources/capture-spike",
            linkerSettings: [
                // Embed an Info.plist into the CLI binary so TCC can read the
                // usage-description strings. Without this, macOS kills the
                // process instead of prompting for mic / audio-capture consent.
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Info.plist",
                ])
            ]
        )
    ]
)
