// swift-tools-version: 6.2
// THROWAWAY SPIKE — see README.md. Not production code.
import PackageDescription

let package = Package(
    name: "recap-tcc-probe",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(
            name: "RecapTCCProbe",
            path: "Sources/RecapTCCProbe",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
