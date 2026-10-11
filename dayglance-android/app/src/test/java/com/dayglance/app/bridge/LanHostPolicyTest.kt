package com.dayglance.app.bridge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URL

/**
 * The network security config permits cleartext app-wide, so LanHostPolicy is
 * the only thing keeping http:// to a public host refused (#2036). Mirrors the
 * cases src/sync/vaultUrlPolicy.js is tested for.
 */
class LanHostPolicyTest {

    @Test
    fun `https is always allowed`() {
        assertTrue(LanHostPolicy.isSecureOrLanUrl(URL("https://vault.example.com/v1")))
        assertTrue(LanHostPolicy.isSecureOrLanUrl(URL("https://10.10.10.2:18800/webdav/")))
    }

    @Test
    fun `http is allowed for loopback and private LAN hosts`() {
        for (u in listOf(
            "http://10.10.10.2/",
            "http://192.168.1.20:8080/dav",
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://127.0.0.1:3000/",
            "http://localhost/",
            "http://vault.localhost/",
            "http://nas.local/",
            "http://[::1]:8080/",
        )) {
            assertTrue(u, LanHostPolicy.isSecureOrLanUrl(URL(u)))
        }
    }

    @Test
    fun `http to a public host is refused`() {
        for (u in listOf(
            "http://vault.example.com/",
            "http://8.8.8.8/",
            "http://172.32.0.1/",
            "http://192.169.1.1/",
            "http://11.0.0.1/",
            "http://10.0.0.256/",
            "http://local.example.com/",
        )) {
            assertFalse(u, LanHostPolicy.isSecureOrLanUrl(URL(u)))
        }
    }

    @Test
    fun `other schemes are refused`() {
        assertFalse(LanHostPolicy.isSecureOrLanUrl(URL("ftp://10.0.0.1/")))
    }
}
