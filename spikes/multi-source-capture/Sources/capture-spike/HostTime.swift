// THROWAWAY SPIKE. Host-time → seconds conversion for drift math.
import Foundation
import Darwin

enum HostTime {
    static let secondsPerTick: Double = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return Double(info.numer) / Double(info.denom) / 1_000_000_000.0
    }()

    static func seconds(_ ticks: UInt64) -> Double { Double(ticks) * secondsPerTick }
    static func now() -> UInt64 { mach_absolute_time() }
}
