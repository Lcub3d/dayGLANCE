package com.dayglance.app.widget.dial

// ─────────────────────────────────────────────────────────────────────────────
// The hub's rows under the rule, by status: the port of DialHubView.rows() in
// the iOS widget. Which rows a state has, in which style, and which ONE of
// them is live (changes every minute: "17m left", "35m open"). Everything
// else is drawn into the face bitmap; the live row is drawn on its own into a
// strip that sits in a fixed slot of the layout (DialLiveSlot), so a minute
// tick sends a strip of a few hundred KB, not the face.
//
// Pure: the words come from a [DialHubCopy] (string resources and locale
// formatting on device, fixed English in the tests) and widths from [measure].
// ─────────────────────────────────────────────────────────────────────────────

enum class DialHubRowStyle {
    /** 15pt semibold white 95 %: a block's title. */
    TITLE,
    /** Title row in the runway's teal: open time. */
    TITLE_OPEN,
    /** Title row in warning amber: Outdated / Time zone changed. */
    TITLE_STATUS,
    /** Title row, white 55 %: Sleep. */
    TITLE_SLEEP,
    /** 11pt italic white 44 %. */
    TAG,
    /** 11.5pt white 58 %: until, time left, open-time detail. */
    DETAIL,
    /** 11pt teal 72 %. */
    RUNWAY,
    /** 9pt white 40 %: Planned as of … */
    NOTE,
}

data class DialHubRow(
    val text: String,
    val style: DialHubRowStyle,
    /** May shrink to [DialSpec.Hub.MINIMUM_SCALE] before it truncates. */
    val shrinks: Boolean = false,
)

/**
 * The layout slots a live row can occupy. The row's baseline and font decide
 * the slot; res/layout/widget_day_dial.xml places an image at each, with
 * weights that must equal [rect] (DialLiveSlotLayoutTest reads the XML).
 */
enum class DialLiveSlot(val baseline: Double, val fontSize: Double) {
    TITLE(DialSpec.Hub.TITLE_Y, DialSpec.Hub.TITLE_FONT_SIZE),
    ROW1(DialSpec.Hub.rowBaseline(1), DialSpec.Hub.COUNTDOWN_FONT_SIZE),
    ROW2(DialSpec.Hub.rowBaseline(2), DialSpec.Hub.COUNTDOWN_FONT_SIZE);

    /** Left, top, width, height in canvas points, whole points so the XML can
     *  state them exactly: the chord at the baseline, from a full ascent
     *  above it to a descent below. */
    val rect: DoubleArray
        get() {
            val half = kotlin.math.ceil(DialSpec.Hub.halfWidth(baseline, DialSpec.Hub.CHORD_INSET))
            val top = kotlin.math.floor(baseline - fontSize * 1.1)
            val bottom = kotlin.math.ceil(baseline + fontSize * 0.35)
            return doubleArrayOf(DialSpec.CX - half, top, 2 * half, bottom - top)
        }

    companion object {
        /** Which slot a row at stack index [index] (or the title, null) lives in. */
        fun of(stackIndex: Int?): DialLiveSlot? = when (stackIndex) {
            null -> TITLE
            1 -> ROW1
            2 -> ROW2
            else -> null
        }
    }
}

enum class DialHubStatus { LIVE, PLACEHOLDER, SET_UP, OUTDATED, ZONE_CHANGED }

/** The words, as the device formats them. */
interface DialHubCopy {
    fun clock(minutesOfDay: Double): String
    /** "1h 10m", "45m", "2h": narrow units, zero units hidden. */
    fun duration(minutes: Double): String
    fun until(clock: String): String
    fun left(duration: String): String
    fun open(duration: String): String
    fun untilSleepAt(clock: String): String
    fun untilAt(title: String, clock: String): String
    fun nothingElseToday(): String
    fun thenOpen(duration: String): String
    fun thenUntilSleep(duration: String): String
    fun sleep(): String
    fun outdated(): String
    fun zoneChanged(): String
    fun openToRefresh(): String
    fun openToSetUp(): String
}

data class DialHubRows(
    val title: DialHubRow?,
    val stack: List<DialHubRow>,
    /** The row that changes every minute: null for the title, else its stack index. */
    val liveIndex: Int? = null,
    val hasLive: Boolean = false,
) {
    val liveRow: DialHubRow? get() = if (!hasLive) null else if (liveIndex == null) title else stack.getOrNull(liveIndex)
    val liveSlot: DialLiveSlot? get() = if (!hasLive) null else DialLiveSlot.of(liveIndex)

    /** Everything drawn into the face: the rows minus the live one. */
    val staticKey: String
        get() = buildList {
            title?.let { if (!(hasLive && liveIndex == null)) add("t:${it.style}|${it.text}") else add("t:${it.style}|<live>") }
            stack.forEachIndexed { i, r -> add("r$i:${r.style}|${if (hasLive && liveIndex == i) "<live>" else r.text}") }
        }.joinToString("\n")

    companion object {
        /**
         * @param measure width of a text in the DETAIL font, canvas points; used to
         *        cut the next block's title so "until … at 12:30" keeps its time.
         */
        fun build(
            status: DialHubStatus,
            state: DialHubState,
            copy: DialHubCopy,
            outdatedDetail: String? = null,
            plannedAsOf: String? = null,
            measure: (String) -> Double = { it.length * 6.0 },
        ): DialHubRows {
            var title: DialHubRow? = null
            val stack = ArrayList<DialHubRow>()
            var liveIndex: Int? = null
            var hasLive = false
            when (status) {
                DialHubStatus.PLACEHOLDER -> Unit
                DialHubStatus.SET_UP -> stack += DialHubRow(copy.openToSetUp(), DialHubRowStyle.DETAIL)
                DialHubStatus.OUTDATED -> {
                    title = DialHubRow(copy.outdated(), DialHubRowStyle.TITLE_STATUS)
                    outdatedDetail?.let { stack += DialHubRow(it, DialHubRowStyle.DETAIL) }
                }
                DialHubStatus.ZONE_CHANGED -> {
                    title = DialHubRow(copy.zoneChanged(), DialHubRowStyle.TITLE_STATUS)
                    stack += DialHubRow(copy.openToRefresh(), DialHubRowStyle.DETAIL)
                }
                DialHubStatus.LIVE -> {
                    val c = state.current
                    val s = state.sleep
                    val o = state.open
                    if (c != null) {
                        title = DialHubRow(c.title, DialHubRowStyle.TITLE, shrinks = true)
                        c.tag?.let { stack += DialHubRow("#$it", DialHubRowStyle.TAG) }
                        stack += DialHubRow(copy.until(copy.clock(c.endMin)), DialHubRowStyle.DETAIL)
                        liveIndex = stack.size
                        hasLive = true
                        stack += DialHubRow(copy.left(copy.duration(c.minutesLeft)), DialHubRowStyle.DETAIL, shrinks = true)
                        state.runwayMinutes?.let { r ->
                            val d = copy.duration(r)
                            stack += DialHubRow(if (state.runwayEndsAtSleep) copy.thenUntilSleep(d) else copy.thenOpen(d), DialHubRowStyle.RUNWAY)
                        }
                    } else if (s != null) {
                        title = DialHubRow(copy.sleep(), DialHubRowStyle.TITLE_SLEEP)
                        stack += DialHubRow(copy.until(copy.clock(s.endMin)), DialHubRowStyle.DETAIL)
                    } else if (o != null) {
                        title = DialHubRow(copy.open(copy.duration(o.minutesUntil)), DialHubRowStyle.TITLE_OPEN, shrinks = true)
                        hasLive = true
                        stack += DialHubRow(openDetail(o, copy, measure), DialHubRowStyle.DETAIL)
                    }
                }
            }
            plannedAsOf?.let { stack += DialHubRow(it, DialHubRowStyle.NOTE, shrinks = true) }
            return DialHubRows(title, stack, liveIndex, hasLive)
        }

        /** "until Lunch at 12:30", "until sleep at 23:00", or "Nothing else today";
         *  the title is cut to the room the phrase leaves it, so the time survives. */
        internal fun openDetail(o: DialHubOpen, copy: DialHubCopy, measure: (String) -> Double): String {
            val end = o.endMin ?: return copy.nothingElseToday()
            val clock = copy.clock(end)
            if (o.nextIsSleep) return copy.untilSleepAt(clock)
            val room = DialSpec.Hub.width(DialSpec.Hub.rowBaseline(0), DialSpec.Hub.CHORD_INSET)
            val frame = copy.untilAt("", clock)
            return copy.untilAt(fit(o.nextTitle ?: "", room - measure(frame), measure), clock)
        }

        /** [text] cut with an ellipsis to fit [width]; whole when it fits. */
        fun fit(text: String, width: Double, measure: (String) -> Double): String {
            if (width <= 0) return "…"
            if (measure(text) <= width) return text
            var chars = text
            while (chars.isNotEmpty()) {
                chars = chars.dropLast(1)
                val candidate = chars.trim() + "…"
                if (measure(candidate) <= width) return candidate
            }
            return "…"
        }
    }
}
