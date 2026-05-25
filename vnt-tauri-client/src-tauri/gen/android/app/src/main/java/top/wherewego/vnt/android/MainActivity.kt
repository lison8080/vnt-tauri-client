package top.wherewego.vnt.android

import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.activity.result.contract.ActivityResultContracts
import top.wherewego.vnt.android.vpn.DeviceConfig
import top.wherewego.vnt.android.vpn.VpnLog
import top.wherewego.vnt.android.vpn.VntVpnService

object AndroidNative {
  init {
    System.loadLibrary("vnt_tauri_desktop_lib")
  }

  @JvmStatic external fun initializeAndroidContext(activity: MainActivity)
}

class MainActivity : TauriActivity() {
  private var systemBarTheme = "light"
  private var systemBarModalOpen = false

  private val vpnPermissionLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val authorized = result.resultCode == RESULT_OK
      VpnLog.record("VPN 授权结果 authorized=$authorized resultCode=${result.resultCode}")
      if (authorized) {
        try {
          VntVpnService.startQueuedVpn(this)
        } catch (error: Exception) {
          VpnLog.record("启动 VPN Service 失败: ${error.message ?: error}")
          Log.e(TAG, "Failed to start queued VPN service", error)
          VntVpnService.failPending(error.message ?: error.toString())
        }
      } else {
        VntVpnService.failPending("用户未授权 VPN 连接")
      }
      synchronized(vpnLock) {
        vpnAuthorized = authorized
        vpnLock.notifyAll()
      }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    AndroidNative.initializeAndroidContext(this)
    super.onCreate(savedInstanceState)
    setActiveActivity(this)
    applySystemBars(defaultSystemBarTheme(), false)
    VpnLog.record("Activity 已创建")
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == VPN_REQUEST_CODE) {
      val authorized = resultCode == RESULT_OK
      VpnLog.record("旧式 VPN 授权回调 authorized=$authorized resultCode=$resultCode")
      if (authorized) {
        try {
          VntVpnService.startQueuedVpn(this)
        } catch (error: Exception) {
          Log.e(TAG, "Failed to start queued VPN service", error)
          VntVpnService.failPending(error.message ?: error.toString())
        }
      } else {
        VntVpnService.failPending("用户未授权 VPN 连接")
      }
      synchronized(vpnLock) {
        vpnAuthorized = authorized
        Log.i(TAG, "VPN authorization result authorized=$vpnAuthorized")
        vpnLock.notifyAll()
      }
      return
    }
    super.onActivityResult(requestCode, resultCode, data)
  }

  companion object {
    private const val TAG = "VntMainActivity"
    private const val VPN_REQUEST_CODE = 8603
    private const val ACTIVITY_READY_TIMEOUT_MS = 30_000L
    private val vpnLock = Object()
    private val activityLock = Object()
    @Volatile private var vpnAuthorized = false
    @Volatile private var activity: MainActivity? = null

    private fun setActiveActivity(nextActivity: MainActivity?) {
      synchronized(activityLock) {
        activity = nextActivity
        activityLock.notifyAll()
      }
    }

    private fun waitForActivity(): MainActivity {
      synchronized(activityLock) {
        val deadline = System.currentTimeMillis() + ACTIVITY_READY_TIMEOUT_MS
        while (activity == null) {
          val remaining = deadline - System.currentTimeMillis()
          if (remaining <= 0) break
          activityLock.wait(remaining)
        }
        return activity ?: throw IllegalStateException("Activity 尚未准备好")
      }
    }

    @JvmStatic
    fun startVpn(
      virtualIp: Int,
      virtualNetmask: Int,
      virtualGateway: Int,
      mtu: Int,
      routeDestinations: IntArray,
      routeNetmasks: IntArray,
    ): Int {
      val currentActivity = waitForActivity()
      val routes = routeDestinations.indices.map { index ->
        DeviceConfig.Route(routeDestinations[index], routeNetmasks[index])
      }
      val config = DeviceConfig(virtualIp, virtualNetmask, virtualGateway, mtu, routes)
      VpnLog.record(
        "收到内核 VPN 创建请求 ip=${top.wherewego.vnt.android.vpn.IpUtils.intToIpAddress(virtualIp)} " +
          "netmask=${top.wherewego.vnt.android.vpn.IpUtils.intToIpAddress(virtualNetmask)} " +
          "gateway=${top.wherewego.vnt.android.vpn.IpUtils.intToIpAddress(virtualGateway)} mtu=$mtu routes=${routes.size}",
      )
      Log.i(TAG, "Preparing VPN interface with routes=${routes.size}")
      val requestId = VntVpnService.queueVpn(config)

      currentActivity.runOnUiThread {
        try {
          val prepareIntent = VpnService.prepare(currentActivity)
          if (prepareIntent != null) {
            synchronized(vpnLock) {
              vpnAuthorized = false
            }
            VpnLog.record("请求系统 VPN 授权")
            currentActivity.vpnPermissionLauncher.launch(prepareIntent)
          } else {
            synchronized(vpnLock) {
              vpnAuthorized = true
              vpnLock.notifyAll()
            }
            VpnLog.record("VPN 已授权，直接启动 Service")
            VntVpnService.startQueuedVpn(currentActivity)
          }
        } catch (error: Exception) {
          VpnLog.record("请求 VPN 授权失败: ${error.message ?: error}")
          Log.e(TAG, "Failed to request VPN authorization", error)
          VntVpnService.failPending(error.message ?: error.toString())
          synchronized(vpnLock) {
            vpnAuthorized = false
            vpnLock.notifyAll()
          }
        }
      }
      return VntVpnService.waitForVpnInterface(requestId)
    }

    @JvmStatic
    fun stopVpn() {
      VpnLog.record("收到停止 VPN 请求")
      VntVpnService.stopVpn()
    }

    @JvmStatic
    fun drainVpnLogs(): Array<String> = VpnLog.drain()

    @JvmStatic
    fun setSystemBars(theme: String, modalOpen: Boolean) {
      val currentActivity = activity ?: return
      currentActivity.runOnUiThread {
        currentActivity.applySystemBars(theme, modalOpen)
      }
    }
  }

  private fun applySystemBars(theme: String, modalOpen: Boolean) {
    systemBarTheme = theme
    systemBarModalOpen = modalOpen
    val dark = theme.equals("dark", ignoreCase = true)
    val systemBarColor = if (modalOpen) {
      if (dark) Color.rgb(10, 14, 25) else Color.rgb(144, 146, 151)
    } else {
      if (dark) Color.rgb(16, 20, 27) else Color.rgb(247, 247, 244)
    }

    WindowCompat.setDecorFitsSystemWindows(window, true)
    window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
    window.clearFlags(
      WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS or
        WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION,
    )
    window.statusBarColor = systemBarColor
    window.navigationBarColor = systemBarColor
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    val controller = WindowInsetsControllerCompat(window, window.decorView)
    val lightIcons = dark
    controller.isAppearanceLightStatusBars = !lightIcons
    controller.isAppearanceLightNavigationBars = !lightIcons
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = systemUiVisibility(lightIcons)
    }
  }

  @Suppress("DEPRECATION")
  private fun systemUiVisibility(lightIcons: Boolean): Int {
    var flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    if (!lightIcons && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
    }
    if (!lightIcons && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      flags = flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
    }
    return flags
  }

  private fun defaultSystemBarTheme(): String {
    val nightMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    return if (nightMode == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
  }

  override fun onResume() {
    super.onResume()
    setActiveActivity(this)
    applySystemBars(systemBarTheme, systemBarModalOpen)
    VpnLog.record("Activity 已恢复")
  }

  override fun onDestroy() {
    if (activity === this) setActiveActivity(null)
    super.onDestroy()
  }
}
