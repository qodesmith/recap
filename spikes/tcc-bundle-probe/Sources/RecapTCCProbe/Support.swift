// THROWAWAY SPIKE. Build stamp (baked by build.sh) + append-only log file so
// the human can paste results even after the window is gone.
import Foundation

struct BuildInfo: Codable {
    let buildId: String
    let builtAt: String
    let signMode: String

    static let current: BuildInfo? = {
        guard let url = Bundle.main.url(forResource: "build-info", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(BuildInfo.self, from: data)
    }()

    static var summary: String {
        guard let b = current else { return "unknown (not launched from a built bundle?)" }
        return "\(b.signMode) · \(b.buildId.prefix(8)) · \(b.builtAt)"
    }
}

enum Log {
    static let fileURL: URL = {
        let logs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Logs", isDirectory: true)
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        return logs.appendingPathComponent("RecapTCCProbe.log")
    }()

    private static let lock = NSLock()

    static func append(_ line: String) {
        lock.lock(); defer { lock.unlock() }
        let stamped = "[\(ISO8601DateFormatter().string(from: Date()))] \(line)\n"
        if FileManager.default.fileExists(atPath: fileURL.path),
           let h = try? FileHandle(forWritingTo: fileURL) {
            h.seekToEndOfFile()
            h.write(Data(stamped.utf8))
            try? h.close()
        } else {
            try? Data(stamped.utf8).write(to: fileURL)
        }
    }
}
