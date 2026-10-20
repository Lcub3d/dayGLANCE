package com.dayglance.app.launcher

/**
 * What a scheduled headless refresh does when its worker finally runs. Pure,
 * so the decision is testable without WorkManager or a WebView; the worker is
 * wiring around it (docs/launcher-integration.md, "Freshness").
 */
object HeadlessRefreshPolicy {
    /** Two headless runs are never closer than this: a WebView boot costs seconds and tens of MB. */
    const val MIN_INTERVAL_MS = 10 * 60_000L
    /** A run that has not reported by then is torn down and logged `failed`. */
    const val CAP_MS = 60_000L

    sealed class Decision {
        /** The renderer is alive by now: queue the REFRESH for it instead (it reports `ran`/`failed`). */
        object HandToLive : Decision()
        /** A headless run finished too recently; the launcher shows the honest age. */
        data class Throttled(val sinceLastMs: Long) : Decision()
        /** Boot the headless WebView. */
        object Run : Decision()
    }

    fun decide(rendererAlive: Boolean, lastRunAt: Long, now: Long): Decision {
        if (rendererAlive) return Decision.HandToLive
        val since = now - lastRunAt
        if (lastRunAt > 0 && since in 0 until MIN_INTERVAL_MS) return Decision.Throttled(since)
        return Decision.Run
    }

    /** The log entry's reason for a throttled run. */
    fun throttledReason(sinceLastMs: Long): String =
        "a headless run finished ${sinceLastMs / 1000} s ago (floor ${MIN_INTERVAL_MS / 60_000} min)"

    /** The outcome the worker records when the web layer did not report one itself. */
    fun unreportedOutcome(aborted: Boolean, timedOut: Boolean, rendererGone: Boolean): Pair<String, String> = when {
        aborted -> "aborted" to "app opened"
        timedOut -> "failed" to "timed out after ${CAP_MS / 1000} s"
        rendererGone -> "failed" to "the WebView renderer died"
        else -> "failed" to "the run ended without reporting"
    }
}
