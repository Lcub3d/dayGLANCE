import React from 'react';

const ORANGE = '#fe8b00';

/**
 * JOBO's icon in both view switchers (the desktop cycler and the phone
 * toggle): solid plan blocks on the left, and on the right a narrow lane of
 * Do that need not line up with them, since what was done can differ from
 * what was planned.
 */
export default function JoboViewIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="10" height="5" rx="1" fill={ORANGE} />
      <rect x="1" y="8" width="10" height="5" rx="1" fill={ORANGE} fillOpacity="0.7" />
      <rect x="13" y="2" width="4" height="4" rx="1" fill={ORANGE} fillOpacity="0.55" />
      <rect x="13" y="8" width="4" height="9" rx="1" fill={ORANGE} fillOpacity="0.55" />
    </svg>
  );
}
