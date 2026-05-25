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
    let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "240.0.0.1")
    settings.mtu = NSNumber(value: mtu)
    settings.ipv4Settings = NEIPv4Settings(addresses: ["240.0.0.2"], subnetMasks: ["255.255.255.0"])
    settings.ipv4Settings?.includedRoutes = [NEIPv4Route.default()]

    setTunnelNetworkSettings(settings) { [weak self] error in
      guard error == nil else {
        completionHandler(error)
        return
      }

      guard let self else { return }
      let profileJson = self.protocolConfiguration.providerConfiguration?["profileJson"] as? String ?? "{}"
      self.sessionId = profileJson.withCString { vntIosPacketFlowStart($0, vnt_ios_packet_flow_write) }
      guard self.sessionId != 0 else {
        completionHandler(NSError(
          domain: "VNT",
          code: -1,
          userInfo: [NSLocalizedDescriptionKey: "VNT packet flow startup failed"]
        ))
        return
      }

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
}
