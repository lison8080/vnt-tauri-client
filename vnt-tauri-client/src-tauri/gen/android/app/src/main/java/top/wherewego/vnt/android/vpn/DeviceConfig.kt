package top.wherewego.vnt.android.vpn

data class DeviceConfig(
  val virtualIp: Int,
  val virtualNetmask: Int,
  val virtualGateway: Int,
  val mtu: Int,
  val externalRoute: List<Route>,
) {
  data class Route(
    val destination: Int,
    val netmask: Int,
  )
}
