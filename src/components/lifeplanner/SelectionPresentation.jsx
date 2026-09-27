import React from 'react';

export default function SelectionPresentation({ marquee }) {
  if (!marquee) return null;
  return <div className="lp-selection-marquee" aria-hidden="true" style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />;
}
