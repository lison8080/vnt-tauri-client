import Foundation
import NetworkExtension

private final class VntIosVpnState {
  static let shared = VntIosVpnState()

  private let lock = NSLock()
  private var lastError: String = ""

  func setError(_ message: String) {
    lock.lock()
    lastError = message
    lock.unlock()
  }

  func getError() -> String {
    lock.lock()
    let value = lastError
    lock.unlock()
    return value
  }
}

@_cdecl("vnt_ios_vpn_start")
public func vnt_ios_vpn_start(_ profileJsonPtr: UnsafePointer<CChar>?) -> Int32 {
  guard let profileJsonPtr else {
    VntIosVpnState.shared.setError("missing iOS VPN profile")
    return -1
  }

  let profileJson = String(cString: profileJsonPtr)
  let semaphore = DispatchSemaphore(value: 0)
  var result: Int32 = -1

  NETunnelProviderManager.loadAllFromPreferences { managers, error in
    if let error {
      VntIosVpnState.shared.setError("load VPN preferences failed: \(error.localizedDescription)")
      semaphore.signal()
      return
    }

    let manager = managers?.first ?? NETunnelProviderManager()
    let provider = NETunnelProviderProtocol()
    provider.providerBundleIdentifier = Bundle.main.bundleIdentifier.map { "\($0).PacketTunnel" }
    provider.serverAddress = "VNT"
    provider.providerConfiguration = ["profileJson": profileJson]

    manager.protocolConfiguration = provider
    manager.localizedDescription = "VNT Core"
    manager.isEnabled = true

    manager.saveToPreferences { saveError in
      if let saveError {
        VntIosVpnState.shared.setError("save VPN preferences failed: \(saveError.localizedDescription)")
        semaphore.signal()
        return
      }

      manager.loadFromPreferences { loadError in
        if let loadError {
          VntIosVpnState.shared.setError("reload VPN preferences failed: \(loadError.localizedDescription)")
          semaphore.signal()
          return
        }

        do {
          try manager.connection.startVPNTunnel()
          result = 0
        } catch {
          VntIosVpnState.shared.setError("start VPN tunnel failed: \(error.localizedDescription)")
        }
        semaphore.signal()
      }
    }
  }

  _ = semaphore.wait(timeout: .now() + 30)
  if result != 0 && VntIosVpnState.shared.getError().isEmpty {
    VntIosVpnState.shared.setError("start VPN tunnel timed out")
  }
  return result
}

@_cdecl("vnt_ios_vpn_stop")
public func vnt_ios_vpn_stop() -> Int32 {
  let semaphore = DispatchSemaphore(value: 0)
  var result: Int32 = 0

  NETunnelProviderManager.loadAllFromPreferences { managers, error in
    if let error {
      VntIosVpnState.shared.setError("load VPN preferences failed: \(error.localizedDescription)")
      result = -1
      semaphore.signal()
      return
    }

    managers?.forEach { $0.connection.stopVPNTunnel() }
    semaphore.signal()
  }

  _ = semaphore.wait(timeout: .now() + 10)
  return result
}

@_cdecl("vnt_ios_vpn_last_error")
public func vnt_ios_vpn_last_error() -> UnsafePointer<CChar>? {
  strdup(VntIosVpnState.shared.getError())
}
