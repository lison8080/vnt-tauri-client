import NetworkExtension

@_silgen_name("vnt_ios_packet_flow_start")
private func vntIosPacketFlowStart(
  _ profileJson: UnsafePointer<CChar>,
  _ packetWriter: @convention(c) (UInt64, UnsafePointer<UInt8>?, Int) -> Void
) -> UInt64

@_silgen_name("vnt_ios_packet_flow_push")
private func vntIosPacketFlowPush(_ sessionId: UInt64, _ packetPtr: UnsafePointer<UInt8>, _ packetLen: Int)

@_silgen_name("vnt_ios_packet_flow_stop")
private func vntIosPacketFlowStop(_ sessionId: UInt64)

@_silgen_name("vnt_ios_packet_flow_network_json")
private func vntIosPacketFlowNetworkJson(_ sessionId: UInt64) -> UnsafeMutablePointer<CChar>?

@_silgen_name("vnt_ios_packet_flow_free_string")
private func vntIosPacketFlowFreeString(_ value: UnsafeMutablePointer<CChar>?)

private weak var activeProvider: PacketTunnelProvider?

@_cdecl("vnt_ios_packet_flow_write")
public func vnt_ios_packet_flow_write(
  _ sessionId: UInt64,
  _ packetPtr: UnsafePointer<UInt8>?,
  _ packetLen: Int
) {
  guard sessionId != 0, let packetPtr, packetLen > 0 else { return }
  let packet = Data(bytes: packetPtr, count: packetLen)
  activeProvider?.writePacket(packet)
}

final class PacketTunnelProvider: NEPacketTunnelProvider {
  private let mtu = 1380
  private var sessionId: UInt64 = 0

  override func startTunnel(
    options: [String : NSObject]?,
    completionHandler: @escaping (Error?) -> Void
  ) {
    activeProvider = self
    let profileJson = protocolConfiguration.providerConfiguration?["profileJson"] as? String ?? "{}"
    let profile = VntIosVpnProfile.decode(profileJson)
    sessionId = profileJson.withCString { vntIosPacketFlowStart($0, vnt_ios_packet_flow_write) }
    guard sessionId != 0 else {
      completionHandler(NSError(
        domain: "VNT",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "VNT packet flow startup failed"]
      ))
      return
    }

    guard let network = loadNetwork(sessionId: sessionId) else {
      vntIosPacketFlowStop(sessionId)
      sessionId = 0
      completionHandler(NSError(
        domain: "VNT",
        code: -2,
        userInfo: [NSLocalizedDescriptionKey: "VNT packet flow network information is missing"]
      ))
      return
    }

    let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: network.gateway)
    settings.mtu = NSNumber(value: network.mtu)
    settings.ipv4Settings = NEIPv4Settings(addresses: [network.ip], subnetMasks: [network.subnetMask])
    settings.ipv4Settings?.includedRoutes = includedRoutes(profile: profile, network: network)

    setTunnelNetworkSettings(settings) { [weak self] error in
      guard error == nil else {
        if let self, self.sessionId != 0 {
          vntIosPacketFlowStop(self.sessionId)
          self.sessionId = 0
        }
        completionHandler(error)
        return
      }

      guard let self else { return }
      self.readPackets()
      completionHandler(nil)
    }
  }

  override func stopTunnel(
    with reason: NEProviderStopReason,
    completionHandler: @escaping () -> Void
  ) {
    if sessionId != 0 {
      vntIosPacketFlowStop(sessionId)
      sessionId = 0
    }
    completionHandler()
  }

  private func readPackets() {
    packetFlow.readPackets { [weak self] packets, protocols in
      guard let self else { return }
      for (index, packet) in packets.enumerated() {
        let protocolNumber = index < protocols.count ? protocols[index] : AF_INET as NSNumber
        self.handlePacket(packet, protocolNumber: protocolNumber)
      }
      self.readPackets()
    }
  }

  private func handlePacket(_ packet: Data, protocolNumber: NSNumber) {
    _ = protocolNumber
    guard sessionId != 0 else { return }
    packet.withUnsafeBytes { rawBuffer in
      guard let base = rawBuffer.bindMemory(to: UInt8.self).baseAddress else { return }
      vntIosPacketFlowPush(sessionId, base, packet.count)
    }
  }

  fileprivate func writePacket(_ packet: Data) {
    packetFlow.writePackets([packet], withProtocols: [AF_INET as NSNumber])
  }

  private func loadNetwork(sessionId: UInt64) -> VntPacketFlowNetwork? {
    guard let raw = vntIosPacketFlowNetworkJson(sessionId) else { return nil }
    defer { vntIosPacketFlowFreeString(raw) }
    let json = String(cString: raw)
    return try? JSONDecoder().decode(VntPacketFlowNetwork.self, from: Data(json.utf8))
  }

  private func includedRoutes(profile: VntIosVpnProfile?, network: VntPacketFlowNetwork) -> [NEIPv4Route] {
    let routes = profile?.outIps.compactMap { cidrRoute($0) } ?? []
    if !routes.isEmpty {
      return routes
    }
    return [NEIPv4Route(destinationAddress: network.network, subnetMask: network.subnetMask)]
  }

  private func cidrRoute(_ value: String) -> NEIPv4Route? {
    let parts = value.split(separator: "/", maxSplits: 1).map(String.init)
    guard parts.count == 2, let prefix = Int(parts[1]), prefix >= 0, prefix <= 32 else {
      return nil
    }
    return NEIPv4Route(destinationAddress: parts[0], subnetMask: subnetMask(prefix: prefix))
  }

  private func subnetMask(prefix: Int) -> String {
    guard prefix > 0 else { return "0.0.0.0" }
    let mask = UInt32.max << UInt32(32 - prefix)
    return [
      UInt8((mask >> 24) & 0xff),
      UInt8((mask >> 16) & 0xff),
      UInt8((mask >> 8) & 0xff),
      UInt8(mask & 0xff),
    ].map(String.init).joined(separator: ".")
  }
}

private struct VntPacketFlowNetwork: Decodable {
  let ip: String
  let prefixLen: UInt8
  let network: String
  let subnetMask: String
  let gateway: String
  let mtu: UInt16
}

private struct VntIosVpnProfile: Decodable {
  let outIps: [String]

  static func decode(_ json: String) -> VntIosVpnProfile? {
    try? JSONDecoder().decode(VntIosVpnProfile.self, from: Data(json.utf8))
  }
}
