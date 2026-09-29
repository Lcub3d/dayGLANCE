// THE FLEET VIEW (2026-09-29, the fleet-wide half of the pairing split).
// Pure.
//
// The incident: two plugin copies (Windows, Linux) sat on a pairing the
// vault had rotated away from, and deleted two days of the fleet's writes.
// Plugin 0.9.2 stopped the deletion and taught a stale copy to stand down
// and say so, but it says so on ITS device, which by construction is the
// one the user is not sitting at. So every plugin copy now publishes a
// plaintext status row to GLANCEvault (`meta:copy:<deviceId>`, see
// bridgeStream.js in the format package), every dayGLANCE device keeps the
// rows it has seen, and this module turns them into what every app
// instance shows: which copies of the vault are current, which are behind,
// and how many changes each is holding back.
//
// A row not renewed for COPY_STATUS_TTL_MS is a copy that is gone (the
// plugin renews hourly and deletes its row on unpair). "Behind" is the
// copy's own verdict (`stale`), or a generation that differs from the
// meta:pairing row this device seals under: a copy running a build that
// predates the verdict still names its generation.

export const BRIDGE_COPIES_KEY = 'dayglance-bridge-copies';
export const COPY_STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Merge copy status rows into the remembered map.
 * @param {Record<string, object>} existing  {deviceId → row}
 * @param {Array<{deviceId: string, row: object|null}>} updates  null = the row was deleted (unpaired)
 */
export function rememberBridgeCopies(existing, updates) {
  const next = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const u of updates || []) {
    const id = String(u?.deviceId ?? '');
    if (!id) continue;
    if (u.row && typeof u.row === 'object' && u.row.kind === 'copy') next[id] = u.row;
    else delete next[id];
  }
  return next;
}

/**
 * The fleet as the panel shows it.
 * @param {Record<string, object>} copies  the remembered rows
 * @param {{generation?: string}|null} meta  the meta:pairing row this device seals under
 * @param {number} [nowMs]
 * @returns {{ copies: object[], behind: object[], current: object[] }}
 */
export function deriveBridgeFleet(copies, meta, nowMs = Date.now()) {
  const vaultGeneration = typeof meta?.generation === 'string' && meta.generation ? meta.generation : null;
  const out = [];
  for (const [deviceId, row] of Object.entries(copies || {})) {
    if (!row || typeof row !== 'object') continue;
    const lastSeenMs = Date.parse(String(row.ts ?? ''));
    if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs > COPY_STATUS_TTL_MS) continue;
    const generation = typeof row.generation === 'string' && row.generation ? row.generation : null;
    const stale = row.stale === true || (vaultGeneration !== null && generation !== null && generation !== vaultGeneration);
    const held = Number.isFinite(Number(row.held)) ? Math.max(0, Math.floor(Number(row.held))) : 0;
    out.push({
      deviceId,
      name: (typeof row.name === 'string' && row.name.trim()) || (typeof row.platform === 'string' && row.platform) || deviceId,
      platform: typeof row.platform === 'string' ? row.platform : null,
      pluginVersion: typeof row.pluginVersion === 'string' ? row.pluginVersion : null,
      generation,
      pairedAt: typeof row.pairedAt === 'string' ? row.pairedAt : null,
      stale, held, lastSeenMs,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId));
  return { copies: out, behind: out.filter((c) => c.stale), current: out.filter((c) => !c.stale) };
}

/** A key naming the set of copies behind, for "say it once per change". */
export function fleetBehindKey(fleet) {
  return (fleet?.behind || []).map((c) => `${c.deviceId}:${c.held}`).sort().join('|') || null;
}
