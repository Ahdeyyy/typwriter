package com.typwriter.systembars

import android.app.Activity
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.math.max

@InvokeArg
class StatusBarArgs {
  var hidden: Boolean = false
}

@InvokeArg
class StyleArgs {
  var dark: Boolean = false
}

/**
 * The app already draws edge to edge (Tauri's MainActivity calls
 * `enableEdgeToEdge()`), so this only adds what the WebView can't do itself:
 *
 *  - hide/show the status bar for the immersive editor and preview,
 *  - pick light or dark bar icons from the *app's* theme (edge-to-edge picks
 *    them from the system theme, which is wrong whenever the two differ),
 *  - report the system-bar insets, since `env(safe-area-inset-*)` reads 0 in
 *    many Android WebViews.
 *
 * Every window call runs on the UI thread: plugin commands arrive on a
 * background thread, and the insets controller is a view API.
 */
@TauriPlugin
class SystemBarsPlugin(private val activity: Activity) : Plugin(activity) {
  private var statusBarHidden = false
  private var darkTheme: Boolean? = null

  private fun controller(): WindowInsetsControllerCompat =
    WindowCompat.getInsetsController(activity.window, activity.window.decorView)

  override fun load(webView: WebView) {
    activity.runOnUiThread {
      // A swipe from the top edge peeks the hidden bar without leaving
      // immersive mode, instead of exiting it for good.
      controller().systemBarsBehavior =
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
  }

  // The system can bring the bar back while the app is in the background, and
  // the WebView may not get a chance to re-assert its state before the user
  // sees the screen again.
  override fun onResume() {
    activity.runOnUiThread { apply() }
  }

  private fun apply() {
    val c = controller()
    if (statusBarHidden) {
      c.hide(WindowInsetsCompat.Type.statusBars())
    } else {
      c.show(WindowInsetsCompat.Type.statusBars())
    }
    darkTheme?.let {
      c.isAppearanceLightStatusBars = !it
      c.isAppearanceLightNavigationBars = !it
    }
  }

  @Command
  fun setStatusBarHidden(invoke: Invoke) {
    val args = invoke.parseArgs(StatusBarArgs::class.java)
    activity.runOnUiThread {
      statusBarHidden = args.hidden
      apply()
      invoke.resolve()
    }
  }

  @Command
  fun setStyle(invoke: Invoke) {
    val args = invoke.parseArgs(StyleArgs::class.java)
    activity.runOnUiThread {
      darkTheme = args.dark
      apply()
      invoke.resolve()
    }
  }

  /**
   * System-bar and cutout insets in CSS px (dp). Measured *ignoring
   * visibility*, so hiding the status bar doesn't shrink the top inset and
   * shift the whole layout up under the user's eyes.
   */
  @Command
  fun getInsets(invoke: Invoke) {
    activity.runOnUiThread {
      val result = JSObject()
      val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
      val density = activity.resources.displayMetrics.density
      if (insets != null && density > 0f) {
        val bars = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars())
        val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
        result.put("top", (max(bars.top, cutout.top) / density).toDouble())
        result.put("bottom", (max(bars.bottom, cutout.bottom) / density).toDouble())
        result.put("left", (max(bars.left, cutout.left) / density).toDouble())
        result.put("right", (max(bars.right, cutout.right) / density).toDouble())
      } else {
        result.put("top", 0)
        result.put("bottom", 0)
        result.put("left", 0)
        result.put("right", 0)
      }
      invoke.resolve(result)
    }
  }
}
