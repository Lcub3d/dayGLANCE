package com.dayglance.app.data.health

import org.junit.Assert.assertEquals
import org.junit.Test

class StepProviderPolicyTest {

    @Test
    fun recentHealthConnectHistoryWins() {
        assertEquals(
            StepProviderChoice.HEALTH_CONNECT,
            chooseStepProvider(
                StepProviderFacts(
                    healthConnectAvailable = true,
                    healthConnectHasPermission = true,
                    healthConnectHasRecentData = true,
                    localRecordingAvailable = true,
                    localRecordingHasPermission = true,
                )
            )
        )
    }

    @Test
    fun localRecordingWinsWhenHealthConnectHasNoRecentData() {
        assertEquals(
            StepProviderChoice.LOCAL_RECORDING,
            chooseStepProvider(
                StepProviderFacts(
                    healthConnectAvailable = true,
                    healthConnectHasPermission = true,
                    healthConnectHasRecentData = false,
                    localRecordingAvailable = true,
                    localRecordingHasPermission = true,
                )
            )
        )
    }

    @Test
    fun localRecordingCanBeChosenBeforePermissionToDrivePrompt() {
        assertEquals(
            StepProviderChoice.LOCAL_RECORDING,
            chooseStepProvider(
                StepProviderFacts(
                    healthConnectAvailable = true,
                    healthConnectHasPermission = true,
                    healthConnectHasRecentData = false,
                    localRecordingAvailable = true,
                    localRecordingHasPermission = false,
                )
            )
        )
    }

    @Test
    fun healthConnectRemainsFallbackWhenLocalRecordingIsUnavailable() {
        assertEquals(
            StepProviderChoice.HEALTH_CONNECT,
            chooseStepProvider(
                StepProviderFacts(
                    healthConnectAvailable = true,
                    healthConnectHasPermission = true,
                    healthConnectHasRecentData = false,
                    localRecordingAvailable = false,
                    localRecordingHasPermission = false,
                )
            )
        )
    }

    @Test
    fun excludingFailedLocalProviderFallsBackToHealthConnect() {
        assertEquals(
            StepProviderChoice.HEALTH_CONNECT,
            chooseStepProvider(
                StepProviderFacts(
                    healthConnectAvailable = true,
                    healthConnectHasPermission = true,
                    healthConnectHasRecentData = false,
                    localRecordingAvailable = true,
                    localRecordingHasPermission = true,
                    excludedProviderId = LocalRecordingStepsProvider.ID,
                )
            )
        )
    }

    @Test
    fun noAvailableProviderReturnsNone() {
        assertEquals(
            StepProviderChoice.NONE,
            chooseStepProvider(
                StepProviderFacts(
                    healthConnectAvailable = false,
                    healthConnectHasPermission = false,
                    healthConnectHasRecentData = false,
                    localRecordingAvailable = false,
                    localRecordingHasPermission = false,
                )
            )
        )
    }
}
