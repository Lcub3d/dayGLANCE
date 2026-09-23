package com.dayglance.app.data.health

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class HonorHealthCredentials(
    val openId: String,
    val accessToken: String,
    val refreshToken: String?,
    val expiresAtMillis: Long,
)

class HonorHealthCredentialStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).also { it.load(null) }

    fun load(): HonorHealthCredentials? {
        val ciphertext = prefs.getString(KEY_CIPHERTEXT, null) ?: return null
        val iv = prefs.getString(KEY_IV, null) ?: return null
        return runCatching {
            val cipher = Cipher.getInstance(AES_GCM)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(GCM_TAG_LENGTH, Base64.decode(iv, Base64.NO_WRAP)),
            )
            val json = JSONObject(
                String(
                    cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)),
                    Charsets.UTF_8,
                )
            )
            HonorHealthCredentials(
                openId = json.getString("openId"),
                accessToken = json.getString("accessToken"),
                refreshToken = json.optString("refreshToken").takeIf { it.isNotBlank() },
                expiresAtMillis = json.optLong("expiresAtMillis", Long.MAX_VALUE),
            )
        }.getOrNull()
    }

    fun save(credentials: HonorHealthCredentials) {
        val plaintext = JSONObject()
            .put("openId", credentials.openId)
            .put("accessToken", credentials.accessToken)
            .put("refreshToken", credentials.refreshToken ?: "")
            .put("expiresAtMillis", credentials.expiresAtMillis)
            .toString()
            .toByteArray(Charsets.UTF_8)

        val cipher = Cipher.getInstance(AES_GCM)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        prefs.edit()
            .putString(
                KEY_CIPHERTEXT,
                Base64.encodeToString(cipher.doFinal(plaintext), Base64.NO_WRAP),
            )
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun getOrCreateKey(): SecretKey {
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (keyStore.getEntry(KEY_ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
        }
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER,
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        private const val PREFS_NAME = "dayglance_honor_health"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "dayglance_honor_health_v1"
        private const val AES_GCM = "AES/GCM/NoPadding"
        private const val GCM_TAG_LENGTH = 128
        private const val KEY_CIPHERTEXT = "credentials"
        private const val KEY_IV = "credentials_iv"
    }
}
