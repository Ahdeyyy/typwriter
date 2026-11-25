package com.typwriter.spellcheck

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.textservice.SentenceSuggestionsInfo
import android.view.textservice.SpellCheckerSession
import android.view.textservice.SuggestionsInfo
import android.view.textservice.TextInfo
import android.view.textservice.TextServicesManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class CheckArgs {
  var texts: Array<String> = arrayOf()
  var suggestionLimit: Int = 5
}

/**
 * Asks the device's spellchecker service (the one the keyboard provides) about
 * prose the app has already pulled out of the Typst source.
 *
 * Everything runs on one private [HandlerThread]: a [SpellCheckerSession]
 * delivers its callbacks on the looper of the thread that created it, and
 * keeping that off the UI thread keeps checking out of the way of input.
 *
 * The session answers one request at a time, and its callbacks carry no request
 * id beyond the cookie on each flagged word, so requests are queued and sent
 * one by one. A request that times out closes the session, so its late answer
 * can never be mistaken for the next request's.
 */
@TauriPlugin
class SpellcheckPlugin(private val activity: Activity) : Plugin(activity) {
  private class Pending(val invoke: Invoke, val texts: Array<String>, val limit: Int) {
    var cookie = 0
    var timeout: Runnable? = null
  }

  private val thread = HandlerThread("typwriter-spellcheck").apply { start() }
  private val handler = Handler(thread.looper)
  private val queue = ArrayDeque<Pending>()
  private var current: Pending? = null
  private var session: SpellCheckerSession? = null
  private var nextCookie = 1

  private val listener = object : SpellCheckerSession.SpellCheckerSessionListener {
    override fun onGetSuggestions(results: Array<out SuggestionsInfo>?) {}

    override fun onGetSentenceSuggestions(results: Array<out SentenceSuggestionsInfo>?) {
      val pending = current ?: return
      val perText = Array(pending.texts.size) { JSArray() }
      for (sentence in results.orEmpty()) {
        if (sentence == null) continue
        for (j in 0 until sentence.suggestionsCount) {
          val info = sentence.getSuggestionsInfoAt(j) ?: continue
          // A flagged word from some other request: not this answer.
          if (info.cookie != pending.cookie) return
          val issue = toIssue(info, sentence.getOffsetAt(j), sentence.getLengthAt(j), pending.limit)
            ?: continue
          perText.getOrNull(info.sequence)?.put(issue)
        }
      }
      finish(pending)
      val all = JSArray()
      perText.forEach { all.put(it) }
      val result = JSObject()
      result.put("available", true)
      result.put("results", all)
      pending.invoke.resolve(result)
      pump()
    }
  }

  @Command
  fun check(invoke: Invoke) {
    val args = invoke.parseArgs(CheckArgs::class.java)
    handler.post {
      queue.addLast(Pending(invoke, args.texts, args.suggestionLimit.coerceIn(0, 10)))
      pump()
    }
  }

  private fun pump() {
    if (current != null) return
    val next = queue.removeFirstOrNull() ?: return
    if (next.texts.isEmpty()) {
      val result = JSObject()
      result.put("available", true)
      result.put("results", JSArray())
      next.invoke.resolve(result)
      pump()
      return
    }
    val s = openSession()
    if (s == null) {
      val result = JSObject()
      result.put("available", false)
      next.invoke.resolve(result)
      pump()
      return
    }
    next.cookie = nextCookie++
    current = next
    val timeout = Runnable {
      if (current === next) {
        current = null
        closeSession()
        next.invoke.reject("The spellchecker did not answer")
        pump()
      }
    }
    next.timeout = timeout
    handler.postDelayed(timeout, TIMEOUT_MS)
    try {
      val infos = next.texts.mapIndexed { i, text -> TextInfo(text, next.cookie, i) }.toTypedArray()
      s.getSentenceSuggestions(infos, next.limit)
    } catch (e: Exception) {
      finish(next)
      closeSession()
      next.invoke.reject(e.message ?: "The spellchecker failed")
      pump()
    }
  }

  private fun finish(pending: Pending) {
    pending.timeout?.let { handler.removeCallbacks(it) }
    if (current === pending) current = null
  }

  /** Null when the device has no spellchecker service or the user turned it off. */
  private fun openSession(): SpellCheckerSession? {
    session?.let { return it }
    val manager = activity.getSystemService(Context.TEXT_SERVICES_MANAGER_SERVICE)
      as? TextServicesManager ?: return null
    if (Build.VERSION.SDK_INT >= 31 && !manager.isSpellCheckerEnabled) return null
    // No locale and `referToSpellCheckerLanguageSettings`: check in the
    // languages the user picked for their spellchecker.
    session = try {
      manager.newSpellCheckerSession(null, null, listener, true)
    } catch (e: Exception) {
      null
    }
    return session
  }

  private fun closeSession() {
    session?.close()
    session = null
  }

  private fun toIssue(info: SuggestionsInfo, offset: Int, length: Int, limit: Int): JSObject? {
    if (length <= 0) return null
    val attrs = info.suggestionsAttributes
    if (attrs and SuggestionsInfo.RESULT_ATTR_IN_THE_DICTIONARY != 0) return null
    if (Build.VERSION.SDK_INT >= 33 &&
      attrs and SuggestionsInfo.RESULT_ATTR_DONT_SHOW_UI_FOR_SUGGESTIONS != 0
    ) return null
    val grammar = Build.VERSION.SDK_INT >= 31 &&
      attrs and SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_GRAMMAR_ERROR != 0
    val typo = attrs and SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_TYPO != 0
    if (!grammar && !typo) return null

    val suggestions = JSArray()
    // -1 when the service sent none.
    for (k in 0 until minOf(info.suggestionsCount, limit)) {
      info.getSuggestionAt(k)?.let { suggestions.put(it) }
    }
    val issue = JSObject()
    issue.put("start", offset)
    issue.put("end", offset + length)
    issue.put("kind", if (grammar) "grammar" else "spelling")
    issue.put("suggestions", suggestions)
    return issue
  }

  // The user may switch keyboards (and so spellcheckers) while we're away, and
  // an idle session keeps the keyboard's service bound for nothing.
  override fun onPause() {
    handler.post { if (current == null) closeSession() }
  }

  override fun onDestroy() {
    handler.post {
      closeSession()
      thread.quitSafely()
    }
  }

  private companion object {
    const val TIMEOUT_MS = 4000L
  }
}
