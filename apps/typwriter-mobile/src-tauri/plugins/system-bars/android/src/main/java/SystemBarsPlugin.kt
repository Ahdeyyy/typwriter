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
    activity.runOnUiThread { measure(invoke, MEASURE_ATTEMPTS) }
  }

  /**
   * Early in startup the window hasn't dispatched its insets yet: the root
   * insets are null, or all zero. Reporting that as "no system bars" would
   * put the whole UI under the status bar (and the frontend caches it), so
   * wait a frame and look again, and fail rather than guess.
   */
  private fun measure(invoke: Invoke, attemptsLeft: Int) {
    val decor = activity.window.decorView
    val insets = ViewCompat.getRootWindowInsets(decor)
    val density = activity.resources.displayMetrics.density
    if (insets != null && density > 0f) {
      // Ignoring visibility keeps the hidden status bar's height; `max` with
      // the visible insets covers older releases where the ignoring-
      // visibility value isn't tracked and reads 0.
      val types = WindowInsetsCompat.Type.systemBars()
      val hidden = insets.getInsetsIgnoringVisibility(types)
      val shown = insets.getInsets(types)
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      val top = maxOf(hidden.top, shown.top, cutout.top)
      val bottom = maxOf(hidden.bottom, shown.bottom, cutout.bottom)
      val left = maxOf(hidden.left, shown.left, cutout.left)
      val right = maxOf(hidden.right, shown.right, cutout.right)
      if (top > 0 || bottom > 0 || left > 0 || right > 0) {
        val result = JSObject()
        result.put("top", (top / density).toDouble())
        result.put("bottom", (bottom / density).toDouble())
        result.put("left", (left / density).toDouble())
        result.put("right", (right / density).toDouble())
        invoke.resolve(result)
        return
      }
    }
    if (attemptsLeft <= 0) {
      invoke.reject("System bar insets are not available yet")
      return
    }
    decor.postDelayed({ measure(invoke, attemptsLeft - 1) }, MEASURE_RETRY_MS)
  }

  private companion object {
    const val MEASURE_ATTEMPTS = 20
    const val MEASURE_RETRY_MS = 50L
  }
}
