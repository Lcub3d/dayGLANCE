package com.dayglance.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * The one staleness rule every Android widget shares, and the worker's
 * patch policy that keeps a stale snapshot honest. Both are pure; the
 * Context-taking label formatter is exercised on device (see the PR's
 * repro steps), not here.
 */
class WidgetFreshnessTest {

    private val today = LocalDate.of(2026, 9, 18)

    // ── evaluate ─────────────────────────────────────────────────────────────

    @Test
    fun `same day is fresh`() {
        val f = WidgetFreshnessRules.evaluate("2026-09-18", 1_000L, today)
        assertFalse(f.isStale)
        assertEquals(0, f.daysOld)
        assertEquals(LocalDate.of(2026, 9, 18), f.snapshotDate)
        assertEquals(1_000L, f.capturedAtMs)
    }

    @Test
    fun `yesterday is stale by one day`() {
        val f = WidgetFreshnessRules.evaluate("2026-09-17", 1_000L, today)
        assertTrue(f.isStale)
        assertEquals(1, f.daysOld)
    }

    @Test
    fun `a weekend away is stale by three days, not just stale`() {
        val f = WidgetFreshnessRules.evaluate("2026-09-15", 1_000L, today)
        assertTrue(f.isStale)
        assertEquals(3, f.daysOld)
    }

    @Test
    fun `a snapshot from tomorrow is stale too - the clock moved back`() {
        val f = WidgetFreshnessRules.evaluate("2026-09-19", 1_000L, today)
        assertTrue(f.isStale)
        assertEquals(-1, f.daysOld)
    }

    @Test
    fun `no date means no information, never stale`() {
        for (missing in listOf(null, "", "   ", "yesterday", "2026-9-18", "18/09/2026")) {
            val f = WidgetFreshnessRules.evaluate(missing, 1_000L, today)
            assertFalse("'$missing' must not be flagged", f.isStale)
            assertEquals(0, f.daysOld)
            assertNull(f.snapshotDate)
            // The capture time still travels so the caller can show it.
            assertEquals(1_000L, f.capturedAtMs)
        }
    }

    @Test
    fun `staleness is about the calendar day, not the age`() {
        // 23:59 → 00:00 flips it; hours within the day do not. The rule only
        // sees dates, so a same-day snapshot is fresh whatever its timestamp.
        val f = WidgetFreshnessRules.evaluate("2026-09-18", 0L, today)
        assertFalse(f.isStale)
    }

    // ── worker patch policy ──────────────────────────────────────────────────

    @Test
    fun `no stored snapshot - build and stamp the calendar-only one`() {
        assertEquals(
            SnapshotPatchDecision.CREATE,
            WidgetSnapshotPatchPolicy.decide(existingSnapshotDate = null, hasExisting = false, today = today),
        )
    }

    @Test
    fun `same-day snapshot - patch native fields only`() {
        assertEquals(
            SnapshotPatchDecision.PATCH_NATIVE_FIELDS,
            WidgetSnapshotPatchPolicy.decide("2026-09-18", hasExisting = true, today = today),
        )
    }

    @Test
    fun `yesterday's snapshot is left untouched - no restamp, no calendar blend`() {
        assertEquals(
            SnapshotPatchDecision.LEAVE_UNTOUCHED,
            WidgetSnapshotPatchPolicy.decide("2026-09-17", hasExisting = true, today = today),
        )
    }

    @Test
    fun `a stored snapshot with no date is patched, never stamped into a date`() {
        // Pre-dates the field: cannot be proven stale, and inventing a date for
        // it is exactly the restamp this policy exists to stop.
        assertEquals(
            SnapshotPatchDecision.PATCH_NATIVE_FIELDS,
            WidgetSnapshotPatchPolicy.decide("", hasExisting = true, today = today),
        )
    }
}
