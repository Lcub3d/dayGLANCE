package com.dayglance.app.data.health

internal enum class StepProviderChoice {
    HEALTH_CONNECT,
    LOCAL_RECORDING,
    NONE,
}

internal data class StepProviderFacts(
    val healthConnectAvailable: Boolean,
    val healthConnectHasPermission: Boolean,
    val healthConnectHasRecentData: Boolean,
    val localRecordingAvailable: Boolean,
    val localRecordingHasPermission: Boolean,
    val excludedProviderId: String? = null,
)

/**
 * Pure first-selection policy for steps.
 *
 * Existing shared history wins. If Health Connect has no recent records, the
 * local Recording API becomes the forward-recording fallback. A provider may
 * be returned before permission is granted so the UI can request the correct
 * permission, but the repository persists it only after permission succeeds.
 */
internal fun chooseStepProvider(facts: StepProviderFacts): StepProviderChoice {
    val healthConnectAllowed =
        facts.excludedProviderId != HealthConnectProvider.ID &&
            facts.healthConnectAvailable
    val localRecordingAllowed =
        facts.excludedProviderId != LocalRecordingStepsProvider.ID &&
            facts.localRecordingAvailable

    if (
        healthConnectAllowed &&
        facts.healthConnectHasPermission &&
        facts.healthConnectHasRecentData
    ) {
        return StepProviderChoice.HEALTH_CONNECT
    }

    if (localRecordingAllowed) {
        return StepProviderChoice.LOCAL_RECORDING
    }

    if (healthConnectAllowed) {
        return StepProviderChoice.HEALTH_CONNECT
    }

    return StepProviderChoice.NONE
}
