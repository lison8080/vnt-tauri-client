package top.wherewego.vnt.android.vpn

import android.content.Intent
import android.content.Context
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import android.util.Log

class VntVpnService : VpnService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    VpnLog.record("VPN Service onStartCommand flags=$flags startId=$startId")
    val config = synchronized(serviceLock) {
      activeService = this
      val nextConfig = pendingConfig
      if (nextConfig != null) {
        activeRequestId = pendingRequestId
      }
      serviceLock.notifyAll()
      nextConfig
    }
    if (config != null) {
      Thread {
        try {
          VpnLog.record("开始建立 Android VPN 网卡")
          Log.i(TAG, "Establishing Android VPN interface")
          val fd = establish(config)
          synchronized(serviceLock) {
            if (activeRequestId == pendingRequestId) {
              pendingFd = fd
              pendingError = null
              pendingConfig = null
              serviceLock.notifyAll()
            } else {
              VpnLog.record("忽略过期 VPN fd fd=$fd active=$activeRequestId latest=$pendingRequestId")
            }
          }
        } catch (error: Exception) {
          VpnLog.record("建立 Android VPN 网卡失败: ${error.message ?: error}")
          Log.e(TAG, "Failed to establish Android VPN interface", error)
          synchronized(serviceLock) {
            if (activeRequestId == pendingRequestId) {
              pendingFd = null
              pendingError = error.message ?: error.toString()
              pendingConfig = null
              serviceLock.notifyAll()
            }
          }
        }
      }.also { it.name = "VNT VPN Establish" }.start()
    } else {
      VpnLog.record("VPN Service 启动但没有待处理配置")
    }
    return START_STICKY
  }

  override fun onDestroy() {
    VpnLog.record("VPN Service onDestroy")
    closeVpnInterface()
    synchronized(serviceLock) {
      if (activeService === this) {
        activeService = null
      }
      serviceLock.notifyAll()
    }
    super.onDestroy()
  }

  private fun establish(config: DeviceConfig): Int {
    closeVpnInterface()
    val prefixLength = IpUtils.subnetMaskToPrefixLength(config.virtualNetmask)
    val routeAddress = IpUtils.intToIpAddress(config.virtualGateway and config.virtualNetmask)
    val virtualIp = IpUtils.intToIpAddress(config.virtualIp)
    Log.i(
      TAG,
      "VPN config ip=$virtualIp prefix=$prefixLength route=$routeAddress mtu=${config.mtu} externalRoutes=${config.externalRoute.size}",
    )
    VpnLog.record("VPN 配置 ip=$virtualIp/$prefixLength route=$routeAddress/$prefixLength mtu=${config.mtu} externalRoutes=${config.externalRoute.size}")
    val builder = Builder()
      .allowFamily(OsConstants.AF_INET)
      .setBlocking(false)
      .setMtu(config.mtu)
      .addAddress(virtualIp, prefixLength)
      .addRoute(routeAddress, prefixLength)
      .setSession("VNT Mesh")

    try {
      builder.addDisallowedApplication(packageName)
      VpnLog.record("VPN 已排除本应用流量，避免内核连接被默认路由捕获")
      Log.i(TAG, "Disallowed own package from VPN: $packageName")
    } catch (error: Exception) {
      VpnLog.record("VPN 排除本应用失败: ${error.message ?: error}")
      Log.w(TAG, "Failed to disallow own package from VPN", error)
    }

    for (route in config.externalRoute) {
      VpnLog.record(
        "VPN 额外路由 ${IpUtils.intToIpAddress(route.destination)}/${IpUtils.subnetMaskToPrefixLength(route.netmask)}",
      )
      Log.i(
        TAG,
        "VPN external route ${IpUtils.intToIpAddress(route.destination)}/${IpUtils.subnetMaskToPrefixLength(route.netmask)}",
      )
      builder.addRoute(
        IpUtils.intToIpAddress(route.destination),
        IpUtils.subnetMaskToPrefixLength(route.netmask),
      )
    }

    vpnInterface = builder.establish() ?: error("无法创建 Android VPN 网卡")
    val fd = vpnInterface!!.fd
    VpnLog.record("Android VPN 网卡已建立 fd=$fd")
    Log.i(TAG, "Android VPN interface established fd=$fd")
    return fd
  }

  companion object {
    private const val TAG = "VntVpnService"
    private const val VPN_ESTABLISH_TIMEOUT_MS = 30_000L
    private val serviceLock = Object()
    @Volatile private var activeService: VntVpnService? = null
    @Volatile private var vpnInterface: ParcelFileDescriptor? = null
    private var pendingConfig: DeviceConfig? = null
    private var pendingFd: Int? = null
    private var pendingError: String? = null
    private var pendingRequestId: Long = 0
    private var activeRequestId: Long = 0

    fun queueVpn(config: DeviceConfig): Long {
      Log.i(TAG, "Queueing VPN config")
      return synchronized(serviceLock) {
        pendingRequestId += 1
        val requestId = pendingRequestId
        VpnLog.record("VPN 配置已入队 request=$requestId")
        pendingConfig = config
        pendingFd = null
        pendingError = null
        requestId
      }
    }

    fun startQueuedVpn(context: Context) {
      VpnLog.record("启动 VPN Service")
      Log.i(TAG, "Starting queued VPN service")
      val intent = Intent(context, VntVpnService::class.java)
      context.startService(intent)
    }

    fun waitForVpnInterface(requestId: Long): Int {
      synchronized(serviceLock) {
        VpnLog.record("等待 VPN fd request=$requestId")
        val deadline = System.currentTimeMillis() + VPN_ESTABLISH_TIMEOUT_MS
        while (activeRequestId != requestId || (pendingFd == null && pendingError == null)) {
          val remaining = deadline - System.currentTimeMillis()
          if (remaining <= 0) {
            if (activeRequestId == requestId || pendingRequestId == requestId) {
              pendingConfig = null
              pendingFd = null
              pendingError = null
              if (activeRequestId == requestId) activeRequestId = 0
            }
            VpnLog.record("等待 VPN fd 超时 request=$requestId")
            throw IllegalStateException("Android VPN 网卡创建超时")
          }
          serviceLock.wait(remaining)
        }
        pendingError?.let { error ->
          pendingError = null
          VpnLog.record("等待 VPN fd 收到错误: $error")
          throw IllegalStateException(error)
        }
        return pendingFd?.also {
          VpnLog.record("等待 VPN fd 完成 request=$requestId fd=$it")
          activeRequestId = 0
          pendingFd = null
        }
          ?: throw IllegalStateException("Android VPN 网卡创建失败")
      }
    }

    fun failPending(message: String) {
      VpnLog.record("VPN 待处理请求失败: $message")
      synchronized(serviceLock) {
        pendingConfig = null
        pendingFd = null
        pendingError = message
        activeRequestId = pendingRequestId
        serviceLock.notifyAll()
      }
    }

    fun stopVpn() {
      VpnLog.record("停止 VPN Service")
      closeVpnInterface()
      val service = synchronized(serviceLock) {
        val service = activeService
        activeService = null
        pendingConfig = null
        pendingFd = null
        pendingError = null
        activeRequestId = 0
        serviceLock.notifyAll()
        service
      }
      service?.stopSelf()
    }

    private fun closeVpnInterface() {
      try {
        if (vpnInterface != null) {
          VpnLog.record("关闭 Android VPN 网卡")
        }
        vpnInterface?.close()
      } catch (error: Exception) {
        VpnLog.record("关闭 Android VPN 网卡失败: ${error.message ?: error}")
        Log.e(TAG, "关闭 VPN 网卡失败", error)
      } finally {
        vpnInterface = null
      }
    }
  }
}
