package com.dayglance.app.data.health

import android.app.Activity
import android.content.Intent
import com.hihonor.cloudservice.support.account.HonorIdSignInManager
import com.hihonor.cloudservice.support.account.request.SignInOptionBuilder
import com.hihonor.cloudservice.support.account.request.SignInOptions
import com.hihonor.cloudservice.support.api.entity.auth.Scope

class HonorHealthAuthController(
    private val activity: Activity,
    private val appId: String,
    tokenExchangeUrl: String,
) {
    private val credentials = HonorHealthCredentialStore(activity.applicationContext)
    private val tokenClient = HonorTokenClient(tokenExchangeUrl)

    fun authorizationIntent(): Intent? {
        if (appId.isBlank()) return null

        val scopes = arrayListOf(
            Scope(STEP_READ_SCOPE),
            Scope(SLEEP_READ_SCOPE),
        )
        val options = SignInOptionBuilder(SignInOptions.DEFAULT_AUTH_REQUEST_PARAM)
            .setClientId(appId)
            .setScopeList(scopes)
            .createParams()

        return HonorIdSignInManager
            .getService(activity, options)
            .getSignInIntent()
    }

    suspend fun handleAuthorizationResult(
        resultCode: Int,
        data: Intent?,
    ): Boolean {
        val task = HonorIdSignInManager.parseAuthResultFromIntent(resultCode, data)
        if (!task.isSuccessful) return false

        val account = task.result ?: return false
        val openId = account.openId ?: return false
        val code = account.authorizationCode ?: return false
        if (openId.isBlank() || code.isBlank()) return false

        val exchanged = tokenClient.exchangeAuthorizationCode(openId, code)
            ?: return false
        credentials.save(exchanged)
        return true
    }

    companion object {
        const val STEP_READ_SCOPE = "https://www.hihonor.com/healthkit/step.read"
        const val SLEEP_READ_SCOPE = "https://www.hihonor.com/healthkit/sleep.read"
    }
}
