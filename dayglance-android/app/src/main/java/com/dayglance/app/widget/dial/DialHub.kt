package com.dayglance.app.widget.dial

// ─────────────────────────────────────────────────────────────────────────────
// The hub's facts at one minute: the port of the iOS DialHub.swift. Which
// block the centre stack narrates, how long it has left, and the open time
// around it. Derived from the day's blocks at the render's own minute, never
// from the snapshot's push-time Up Next. Pure; the widget only formats it.
// ─────────────────────────────────────────────────────────────────────────────

data class DialHubCurrent(
    val id: String,
    val title: String,
    /** First tag, without `#`. */
    val tag: String?,
    val startMin: Double,
    /** The real end, past 1440 when it runs into tomorrow. */
    val endMin: Double,
    val minutesLeft: Double,
)

data class DialHubOpen(
    val minutesUntil: Double,
    /** The next block's start, or null with nothing else today. */
    val endMin: Double?,
    /** The block that ends the open time; null for sleep or nothing. */
    val nextTitle: String?,
    val nextIsSleep: Boolean,
)

data class DialHubSleep(val endMin: Double, val minutesLeft: Double)

data class DialHubState(
    val current: DialHubCurrent? = null,
    val runwayMinutes: Double? = null,
    val runwayEndsAtSleep: Boolean = false,
    val sleep: DialHubSleep? = null,
    val open: DialHubOpen? = null,
)

object DialHub {
    /** Sleep is context, never schedule: never "current". */
    fun isNarrated(block: DialFaceBlock): Boolean = block.kind != DialBlockKind.SLEEP

    /** The running narrated block; the LATEST-starting one when blocks nest. */
    fun currentBlock(blocks: List<DialFaceBlock>, nowMin: Double): DialFaceBlock? {
        var running: DialFaceBlock? = null
        for (b in blocks) {
            if (!isNarrated(b) || b.startMin > nowMin || nowMin >= b.endMin) continue
            val r = running
            if (r == null || b.startMin > r.startMin) running = b
        }
        return running
    }

    /** The first block of any kind starting at or after [minute]; ties keep list order. */
    fun nextBlock(minute: Double, blocks: List<DialFaceBlock>): DialFaceBlock? {
        var best: DialFaceBlock? = null
        for (b in blocks) {
            if (b.startMin < minute) continue
            val cur = best
            if (cur == null || b.startMin < cur.startMin) best = b
        }
        return best
    }

    fun sleepBlock(blocks: List<DialFaceBlock>, nowMin: Double): DialFaceBlock? =
        blocks.firstOrNull { it.kind == DialBlockKind.SLEEP && it.startMin <= nowMin && nowMin < it.endMin }

    fun resolve(blocks: List<DialFaceBlock>, nowMin: Double): DialHubState {
        currentBlock(blocks, nowMin)?.let { b ->
            val end = b.trueEndMin
            val current = DialHubCurrent(b.id, b.title ?: "", b.tag?.takeIf { it.isNotEmpty() }, b.startMin, end, end - nowMin)
            var runway: Double? = null
            var toSleep = false
            if (!b.endsNextDay) {
                val next = nextBlock(end, blocks)
                if (next != null && next.startMin - end >= DialSpec.Hub.RUNWAY_MINIMUM_MINUTES) {
                    runway = next.startMin - end
                    toSleep = next.kind == DialBlockKind.SLEEP
                }
            }
            return DialHubState(current = current, runwayMinutes = runway, runwayEndsAtSleep = toSleep)
        }
        sleepBlock(blocks, nowMin)?.let { s ->
            val end = s.trueEndMin
            return DialHubState(sleep = DialHubSleep(end, end - nowMin))
        }
        val next = nextBlock(nowMin, blocks)
        val open = if (next != null && next.startMin > nowMin) {
            val isSleep = next.kind == DialBlockKind.SLEEP
            DialHubOpen(next.startMin - nowMin, next.startMin, if (isSleep) null else (next.title ?: ""), isSleep)
        } else {
            DialHubOpen(DialGeometry.DAY_MINUTES - nowMin, null, null, false)
        }
        return DialHubState(open = open)
    }
}
