package com.dayglance.app.launcher

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/** The weather carry a headless snapshot gets: it fetches no forecast, so the last one stays. */
class LauncherWritesTest {
    private val withWeather = """{"version":1,"tasks":[],"weather":[{"id":"2026-10-19","date":"2026-10-19","hours":[{"hour":9,"temp":55}]}]}"""
    private val without = """{"version":1,"tasks":[{"id":"t2"}],"weather":[]}"""

    @Test
    fun `an empty weather collection takes the previous snapshot's`() {
        val merged = JSONObject(LauncherWrites.withCarriedWeather(without, withWeather))
        assertEquals("t2", merged.getJSONArray("tasks").getJSONObject(0).getString("id"))
        assertEquals(55, merged.getJSONArray("weather").getJSONObject(0).getJSONArray("hours").getJSONObject(0).getInt("temp"))
    }

    @Test
    fun `a snapshot with weather, or one with nothing to carry from, is stored as is`() {
        assertSame(withWeather, LauncherWrites.withCarriedWeather(withWeather, without))
        assertSame(without, LauncherWrites.withCarriedWeather(without, null))
        assertSame(without, LauncherWrites.withCarriedWeather(without, """{"version":1,"weather":[]}"""))
        assertSame(without, LauncherWrites.withCarriedWeather(without, "not json"))
    }
}
