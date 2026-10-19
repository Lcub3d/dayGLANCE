package com.dayglance.app.launcher

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The snapshot-to-rows mapping the LauncherProvider serves, over the JSON the web layer pushes. */
class LauncherSnapshotRowsTest {

    private val snapshot = """
        {"version":1,"updatedAt":1760000000000,"timezone":"America/Denver","today":"2026-10-19",
         "tasks":[{"id":"t1","title":"Run","date":"2026-10-19"},{"id":"i1","title":"Call dentist","date":null}],
         "goals":[{"id":"g1","title":"Half marathon"}],
         "projects":[],
         "routines":[{"id":"r1","name":"Stretch","completed":false}],
         "frames":[{"id":"f1:2026-10-19","frameId":"f1","date":"2026-10-19"}],
         "weather":[{"id":"2026-10-19","date":"2026-10-19","unit":"fahrenheit","hours":[{"hour":9,"temp":55,"code":0,"uv":2.3}]}],
         "dayShape":{"dayStartMin":420,"dayStopMin":1350,"sunriseMin":432,"sunsetMin":1104,"use24HourClock":false},
         "handledWrites":[{"clientId":"w-1","taskId":"t1","action":"create"}]}
    """.trimIndent()

    @Test
    fun `an array collection is one row per object, keyed by its id`() {
        val rows = LauncherSnapshotRows.rows(snapshot, "tasks")!!
        assertEquals(listOf("t1", "i1"), rows.map { it.id })
        assertEquals("Call dentist", JSONObject(rows[1].json).getString("title"))
        assertTrue(JSONObject(rows[1].json).isNull("date"))
        assertEquals(0, LauncherSnapshotRows.rows(snapshot, "projects")!!.size)
        val weather = LauncherSnapshotRows.rows(snapshot, "weather")!!.single()
        assertEquals("2026-10-19", weather.id)
        assertEquals(55, JSONObject(weather.json).getJSONArray("hours").getJSONObject(0).getInt("temp"))
    }

    @Test
    fun `dayShape and meta are single rows`() {
        val shape = LauncherSnapshotRows.rows(snapshot, "dayShape")!!.single()
        assertEquals("today", shape.id)
        assertEquals(420, JSONObject(shape.json).getInt("dayStartMin"))
        val meta = JSONObject(LauncherSnapshotRows.rows(snapshot, "meta")!!.single().json)
        assertEquals(1, meta.getInt("version"))
        assertEquals("2026-10-19", meta.getString("today"))
        assertEquals("w-1", meta.getJSONArray("handledWrites").getJSONObject(0).getString("clientId"))
    }

    @Test
    fun `meta carries the heartbeat, the refresh log and liveness, even without a snapshot`() {
        val hb = """{"checkedAt":1760000100000,"syncedAt":"2026-10-19T08:00:00.000Z"}"""
        val log = """[{"clientId":"r1","requestedAt":1,"outcome":"queued","liveness":"alive"}]"""
        val meta = JSONObject(LauncherSnapshotRows.rows(snapshot, "meta", hb, log, true)!!.single().json)
        assertEquals(1760000000000L, meta.getLong("updatedAt"))
        assertEquals(1760000100000L, meta.getLong("checkedAt"))
        assertEquals("2026-10-19T08:00:00.000Z", meta.getString("syncedAt"))
        assertTrue(meta.getBoolean("rendererAlive"))
        assertTrue(!meta.has("headlessRunning"))
        assertEquals("queued", meta.getJSONArray("refreshLog").getJSONObject(0).getString("outcome"))
        val headless = JSONObject(LauncherSnapshotRows.rows(snapshot, "meta", hb, log, false, headlessRunning = true)!!.single().json)
        assertTrue(headless.getBoolean("headlessRunning"))
        assertTrue(!headless.getBoolean("rendererAlive"))
        // A heartbeat before any snapshot still answers.
        val bare = JSONObject(LauncherSnapshotRows.rows(null, "meta", hb, null, false)!!.single().json)
        assertEquals(1760000100000L, bare.getLong("checkedAt"))
        assertTrue(!bare.has("updatedAt"))
        assertEquals(0, LauncherSnapshotRows.rows(null, "meta", null, null, null)!!.size)
    }

    @Test
    fun `an unknown collection is null, no snapshot or bad JSON is empty`() {
        assertNull(LauncherSnapshotRows.rows(snapshot, "habits"))
        assertEquals(0, LauncherSnapshotRows.rows(null, "tasks")!!.size)
        assertEquals(0, LauncherSnapshotRows.rows("not json", "tasks")!!.size)
        assertEquals(0, LauncherSnapshotRows.rows("""{"version":1}""", "dayShape")!!.size)
    }
}
