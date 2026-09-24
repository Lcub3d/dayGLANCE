// Renders a minute count as a compact translated duration ("2h 15m", "45m",
// "3h"), picking whichever of the three `common.duration*` keys has no
// zero-valued part so languages never have to translate a literal "0m"/"0h".
export function formatDuration(minutes, t) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return t('common.durationMinutes', { minutes: mins });
  if (mins === 0) return t('common.durationHours', { hours });
  return t('common.durationHoursMinutes', { hours, minutes: mins });
}
