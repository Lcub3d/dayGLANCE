package com.dayglance.app.data.health

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class HonorTokenClient(
    private val endpoint: String,
) {
    suspend fun exchangeAuthorizationCode(
        openId: String,
        authorizationCode: String,
    ): HonorHealthCredentials? = withContext(Dispatchers.IO) {
        val payload = post(
            JSONObject()
                .put("grantType", "authorization_code")
                .put("code", authorizationCode)
        ) ?: return@withContext null
        credentialsFromPayload(openId, payload, fallbackRefreshToken = null)
    }

    suspend fun refresh(
        credentials: HonorHealthCredentials,
    ): HonorHealthCredentials? = withContext(Dispatchers.IO) {
        val refreshToken = credentials.refreshToken ?: return@withContext null
        val payload = post(
            JSONObject()
                .put("grantType", "refresh_token")
                .put("refreshToken", refreshToken)
        ) ?: return@withContext null
        credentialsFromPayload(
            credentials.openId,
            payload,
            fallbackRefreshToken = refreshToken,
        )
    }

    private fun post(body: JSONObject): JSONObject? {
        if (endpoint.isBlank()) return null
        return runCatching {
            val url = URL(endpoint)
            require(url.protocol == "https") { "HONOR token endpoint must use HTTPS" }

            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.outputStream.use {
                it.write(body.toString().toByteArray(Charsets.UTF_8))
            }

            val status = connection.responseCode
            val responseBody = (
                if (status in 200..299) connection.inputStream else connection.errorStream
            )?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            connection.disconnect()

            if (status !in 200..299 || responseBody.isBlank()) null
            else JSONObject(responseBody)
        }.getOrNull()
    }

    private fun credentialsFromPayload(
        openId: String,
        payload: JSONObject,
        fallbackRefreshToken: String?,
    ): HonorHealthCredentials? {
        val accessToken = payload.optString("accessToken")
        if (accessToken.isBlank()) return null

        val expiresInSeconds = payload.optLong("expiresIn", 0L)
        val expiresAtMillis = if (expiresInSeconds > 0) {
            System.currentTimeMillis() + expiresInSeconds * 1000L
        } else {
            Long.MAX_VALUE
        }

        return HonorHealthCredentials(
            openId = openId,
            accessToken = accessToken,
            refreshToken = payload.optString("refreshToken")
                .takeIf { it.isNotBlank() }
                ?: fallbackRefreshToken,
            expiresAtMillis = expiresAtMillis,
        )
    }
}
