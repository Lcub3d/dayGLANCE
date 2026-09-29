import React from 'react';
import { useTranslation } from 'react-i18next';
import { activeLocale } from '../utils/localeFormatting.js';

// THE FLEET LIST (2026-09-29, the fleet-wide half of the pairing split):
// every copy of the vault as its own plugin reports it, on EVERY device.
// The stale copy's own device was the one saying "behind" before this,
// which by construction is the machine the user is not sitting at. Red
// where a copy is behind or where this device's own changes have waited
// past the delivery check's threshold while a copy is applying; quiet
// otherwise. Shared by the desktop pairing panel and the native status
// panel. Inputs come from utils/bridgeFleet.js and the stream module's
// delivery state; this renders and decides nothing.
const BridgeFleetList = ({ fleet, delivery, textSecondary }) => {
  const { t } = useTranslation();
  const copies = fleet?.copies || [];
  const behind = fleet?.behind || [];
  const waiting = Number(delivery?.waiting) || 0;
  if (copies.length === 0 && waiting === 0) return null;
  const date = (iso) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(activeLocale()) : '?';
  };
  return (
    <div className="space-y-1" data-bridge-fleet>
      {waiting > 0 && (
        <p data-bridge-delivery-waiting className="text-xs text-red-500">{t('settings.obsidianBridgeDeliveryWaiting', { count: waiting })}</p>
      )}
      {behind.length > 0 && (
        <p data-bridge-fleet-behind className="text-xs text-red-500">{t('settings.obsidianBridgeFleetBehind', { names: behind.map((c) => c.name).join(', ') })}</p>
      )}
      {copies.length > 0 && (
        <>
          <p className={`text-xs font-medium ${textSecondary}`}>{t('settings.obsidianBridgeCopiesTitle')}</p>
          {copies.map((c) => (
            <p key={c.deviceId} data-bridge-copy={c.stale ? 'behind' : 'current'} className={`text-xs ${c.stale ? 'text-red-500' : textSecondary}`}>
              {c.stale
                ? t('settings.obsidianBridgeCopyBehind', { name: c.name, date: date(c.pairedAt) })
                : t('settings.obsidianBridgeCopyCurrent', { name: c.name })}
              {c.held > 0 ? ` ${t('settings.obsidianBridgeCopyHeld', { count: c.held })}` : ''}
            </p>
          ))}
        </>
      )}
    </div>
  );
};

export default BridgeFleetList;
