import { useEffect, useState } from 'react';

// Whether the window is at least `px` wide, kept current on resize. 1600 is
// the app's wide-desktop breakpoint (useVisibleDays shows three days there).
export default function useMinWidth(px) {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return wide;
}
