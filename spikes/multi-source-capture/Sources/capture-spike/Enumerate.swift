// THROWAWAY SPIKE. Proves point (1) of the ticket: what a source-picker UI
// could enumerate, and what metadata is available per source.
import Foundation
import AVFoundation
import CoreAudio
import AppKit

enum Enumerate {
    static func run() {
        print("\n=== MICROPHONES / INPUT DEVICES (AVFoundation) ===")
        let session = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio,
            position: .unspecified
        )
        if session.devices.isEmpty { print("  (none — or discovery needs mic consent first)") }
        for d in session.devices {
            print("  • \(d.localizedName)  [uid: \(d.uniqueID)]  model: \(d.modelID)")
        }

        print("\n=== AUDIO PROCESSES (Core Audio kAudioHardwarePropertyProcessObjectList) ===")
        let procs = audioProcessObjectIDs()
        if procs.isEmpty { print("  (none reported)") }
        for pid in procs {
            let bundleID = stringProp(pid, kAudioProcessPropertyBundleID) ?? "?"
            let osPID = int32Prop(pid, kAudioProcessPropertyPID)
            let out = boolProp(pid, kAudioProcessPropertyIsRunningOutput)
            let input = boolProp(pid, kAudioProcessPropertyIsRunningInput)
            var appName = "?"
            var hasIcon = false
            if let osPID, let app = NSRunningApplication(processIdentifier: osPID) {
                appName = app.localizedName ?? "?"
                hasIcon = app.icon != nil
            }
            let flags = "\(out ? "OUT " : "")\(input ? "IN " : "")".trimmingCharacters(in: .whitespaces)
            print("  • \(appName)  [\(bundleID)]  pid:\(osPID.map(String.init) ?? "?")  icon:\(hasIcon ? "yes" : "no")  \(flags.isEmpty ? "idle" : flags)")
        }
    }

    static func audioProcessObjectIDs() -> [AudioObjectID] {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
        let count = Int(size) / MemoryLayout<AudioObjectID>.size
        var ids = [AudioObjectID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
        return ids
    }

    static func stringProp(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<CFString?>.size)
        var value: CFString? = nil
        let status = withUnsafeMutablePointer(to: &value) {
            AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, $0)
        }
        guard status == noErr, let value else { return nil }
        return value as String
    }

    static func int32Prop(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Int32? {
        var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<Int32>.size)
        var value: Int32 = 0
        guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value) == noErr else { return nil }
        return value
    }

    static func boolProp(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Bool {
        var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<UInt32>.size)
        var value: UInt32 = 0
        guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value) == noErr else { return false }
        return value != 0
    }
}
