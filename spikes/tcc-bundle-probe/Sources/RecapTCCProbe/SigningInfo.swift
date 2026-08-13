// THROWAWAY SPIKE. Reads this process's own code signature so the window and
// the log always show which identity the running build was signed with — the
// experiment is meaningless if you can't tell which build you're looking at.
import Foundation
import Security

enum SigningInfo {
    static func summary() -> String {
        var codeRef: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &codeRef) == errSecSuccess, let code = codeRef else {
            return "signing: <SecCodeCopySelf failed>"
        }
        var staticRef: SecStaticCode?
        guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticRef) == errSecSuccess, let staticCode = staticRef else {
            return "signing: <SecCodeCopyStaticCode failed>"
        }
        var infoRef: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &infoRef) == errSecSuccess,
              let info = infoRef as? [String: Any] else {
            return "signing: <SecCodeCopySigningInformation failed — unsigned?>"
        }
        let ident = info[kSecCodeInfoIdentifier as String] as? String ?? "?"
        let team = info[kSecCodeInfoTeamIdentifier as String] as? String ?? "none"
        let cdhash = (info[kSecCodeInfoUnique as String] as? Data)?.map { String(format: "%02x", $0) }.joined() ?? "?"
        var signer = "ad-hoc (no certificate chain)"
        if let certs = info[kSecCodeInfoCertificates as String] as? [Any], !certs.isEmpty {
            let cert = certs[0] as! SecCertificate
            if let name = SecCertificateCopySubjectSummary(cert) as String? { signer = name }
        }
        return "signing: signer=\(signer)  team=\(team)  id=\(ident)  cdhash=\(cdhash.prefix(16))…"
    }
}
