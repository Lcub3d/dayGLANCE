import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { getLoadFailures, subscribeLoadFailures, discardLoadFailures } from '../utils/loadFailures.js';
import { getWriteFailures, subscribeWriteFailures } from '../utils/storageWrites.js';

// Persistent notice for storage that is not keeping the user's data: saved
// data that could not be read at load (#2138), or writes the store rejected
// because it is full (#2139). One banner, because both sit in the same place
// and the load failure is the more urgent of the two.
//
// Saved data that could not be read at load (#2138):
// While it shows, the save pass leaves those keys alone (utils/loadFailures.js),
// so the user's changes to that data are not being saved. A console line was
// all this used to get, right before the store was overwritten with nothing.
//
// It clears itself when the keys are repaired from elsewhere (a sync apply or a
// restore writes valid data there). Otherwise the user can download the raw
// values, which is the only copy, or discard them so saving resumes.
//
// Storage full (#2139): the write helper (utils/storageWrites.js) records each
// key the store rejected, and the notice clears once those keys write again.
// The user's way out is to see what is using the space.
//
// `onDownload(filename, text)` is App's file export, so the native shells get
// their share sheet instead of the <a download> that their WebViews ignore.
export default function StorageBanner({ darkMode, onDownload, onOpenStorage }) {
  const { t } = useTranslation();
  const [failures, setFailures] = useState(getLoadFailures);
  const [writeFailures, setWriteFailures] = useState(getWriteFailures);

  useEffect(() => {
    const refresh = () => setFailures(getLoadFailures());
    const refreshWrites = () => setWriteFailures(getWriteFailures());
    refresh();
    refreshWrites();
    const offLoad = subscribeLoadFailures(refresh);
    const offWrite = subscribeWriteFailures(refreshWrites);
    return () => { offLoad(); offWrite(); };
  }, []);

  if (failures.length === 0 && writeFailures.length === 0) return null;

  const download = () => {
    const contents = Object.fromEntries(failures.map(({ key, raw, message }) => [key, { error: message, raw }]));
    const stamp = new Date().toISOString().slice(0, 10);
    onDownload(`dayglance-unreadable-data-${stamp}.json`, JSON.stringify(contents, null, 2));
  };

  const discard = () => {
    if (window.confirm(t('storage.loadFailedDiscardConfirm'))) discardLoadFailures();
  };

  const buttonClass = `rounded-full px-3 py-1 font-semibold transition-colors ${
    darkMode ? 'bg-amber-400 text-amber-950 hover:bg-amber-300' : 'bg-amber-600 text-white hover:bg-amber-700'
  }`;

  return (
    <div
      role="alert"
      className={`fixed top-0 inset-x-0 z-[10000] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-xs ${
        darkMode
          ? 'bg-amber-500/15 text-amber-200 border-b border-amber-500/30'
          : 'bg-amber-100 text-amber-900 border-b border-amber-300'
      }`}
    >
      {failures.length > 0 ? (
        <>
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span>
              <span className="font-semibold">{t('storage.loadFailedTitle')}</span>{' '}
              {t('storage.loadFailedBody')}
            </span>
          </span>
          <button type="button" onClick={download} className={buttonClass}>
            {t('storage.loadFailedDownload')}
          </button>
          <button type="button" onClick={discard} className="underline underline-offset-2 font-medium">
            {t('storage.loadFailedDiscard')}
          </button>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span>{t('backup.storageFull')}</span>
          </span>
          <button type="button" onClick={onOpenStorage} className={buttonClass}>
            {t('storage.seeWhatIsUsingSpace')}
          </button>
        </>
      )}
    </div>
  );
}
