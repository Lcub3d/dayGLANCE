package com.dayglance.app.bridge

import java.net.URL

/**
 * URL transport-security allowlist for the app's native HTTP clients. Mirrors
 * src/sync/vaultUrlPolicy.js: https is always allowed; http only for
 * loopback / private-LAN / *.local hosts; any other scheme is refused.
 *
 * res/xml/network_security_config.xml permits cleartext app-wide because the
 * platform cannot scope it to IP ranges, so this check is what keeps http:// to
 * a public host refused. Every native request path must go through it.
 */
object LanHostPolicy {

    /** https is always allowed; http only for loopback/LAN hosts; anything else no. */
    fun isSecureOrLanUrl(url: URL): Boolean {
        val scheme = (url.protocol ?: "").lowercase()
        if (scheme == "https") return true
        if (scheme != "http") return false
        return isLocalOrLanHost(url.host ?: "")
    }

    /** True for loopback / private-LAN / *.local hosts, where cleartext http is ok. */
    fun isLocalOrLanHost(rawHost: String): Boolean {
        var host = rawHost.trim().lowercase()
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length - 1)
        if (host.isEmpty()) return false
        if (host == "localhost" || host.endsWith(".localhost")) return true
        if (host == "::1") return true
        if (host.endsWith(".local")) return true
        val m = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""").find(host) ?: return false
        val octets = m.groupValues.drop(1).map { it.toInt() }
        if (octets.any { it > 255 }) return false
        val (a, b) = octets
        return when {
            a == 127 -> true               // 127.0.0.0/8 loopback
            a == 10 -> true                // 10.0.0.0/8
            a == 192 && b == 168 -> true   // 192.168.0.0/16
            a == 172 && b in 16..31 -> true // 172.16.0.0/12
            else -> false
        }
    }
}
