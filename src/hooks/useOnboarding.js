import { useState, useEffect } from 'react';
import { writeItem } from '../utils/storageWrites.js';

const useOnboarding = () => {
  // Onboarding state - start false, set true after data loads if zero tasks
  const [showWelcome, setShowWelcome] = useState(false);
  const [gettingStartedDismissed, setGettingStartedDismissed] = useState(() => {
    return localStorage.getItem('gettingStartedDismissed') === 'true';
  });
  const [onboardingComplete, setOnboardingComplete] = useState(false); // Session-only: user clicked "I'm Good to Go"
  const [onboardingProgress, setOnboardingProgress] = useState(() => {
    const saved = localStorage.getItem('onboardingProgress');
    return saved ? JSON.parse(saved) : {
      hasAddedInboxTask: false,
      hasAddedScheduledTask: false,
      hasDraggedToTimeline: false,
      hasAddedDeadline: false,
      hasSetPriority: false,
      hasAddedNotes: false,
      hasUsedTags: false,
      hasUsedActionButtons: false,
      hasCompletedTask: false,
      hasSetupSync: false,
      hasCreatedRecurring: false,
      hasSetupRoutines: false,
      hasUsedFocusMode: false,
      hasEnabledOptionalFeature: false,
    };
  });

  useEffect(() => {
    if (gettingStartedDismissed) {
      writeItem('gettingStartedDismissed', 'true');
    }
  }, [gettingStartedDismissed]);

  useEffect(() => {
    writeItem('onboardingProgress', JSON.stringify(onboardingProgress));
  }, [onboardingProgress]);

  return {
    showWelcome, setShowWelcome,
    gettingStartedDismissed, setGettingStartedDismissed,
    onboardingComplete, setOnboardingComplete,
    onboardingProgress, setOnboardingProgress,
  };
};

export default useOnboarding;
