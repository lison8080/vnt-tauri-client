package top.wherewego.vnt.android.vpn

import android.util.Log
import java.util.ArrayDeque

object VpnLog {
  private const val TAG = "VntVpn"
  private const val LIMIT = 300
  private val lines = ArrayDeque<String>()

  @Synchronized
  fun record(line: String) {
    val entry = if (line.startsWith("[vpn]")) line else "[vpn] $line"
    Log.i(TAG, entry)
    lines.addLast(entry)
    while (lines.size > LIMIT) {
      lines.removeFirst()
    }
  }

  @Synchronized
  fun drain(): Array<String> {
    val copy = lines.toTypedArray()
    lines.clear()
    return copy
  }
}
