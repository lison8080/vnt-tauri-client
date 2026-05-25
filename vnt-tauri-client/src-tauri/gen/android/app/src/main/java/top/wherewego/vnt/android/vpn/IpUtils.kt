package top.wherewego.vnt.android.vpn

object IpUtils {
  fun intToIpAddress(ipAddress: Int): String {
    return "${ipAddress ushr 24 and 0xff}.${ipAddress ushr 16 and 0xff}.${ipAddress ushr 8 and 0xff}.${ipAddress and 0xff}"
  }

  fun subnetMaskToPrefixLength(subnetMask: Int): Int {
    var mask = subnetMask
    var prefixLength = 0
    var bit = 1 shl 31
    while (mask != 0) {
      if ((mask and bit) != bit) break
      prefixLength++
      mask = mask shl 1
    }
    return prefixLength
  }
}
