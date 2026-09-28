# Lifemap support network (Jobu)

This feature belongs to **`product/jobu`**, not an upstream JOBO slice. Open
**Life → Life Map → Support network** (中文：人生规划 → 人生蓝图 → 支撑网络).
The existing notebook, native goal/project/task ownership and JOBO ledger are
unchanged. No new runtime dependency is added.

## Using the map

1. Keep writing wishes, visions and goals as before. Opening the network does
   not create durable data or force ratings. Nodes already in the map are reused.
2. Drag from a node's lower-right support handle to another node's lower-left
   handle, or use **Add relation** and select both endpoints. A form previews the
   relation; nothing is saved until confirmed. Same-level and cross-level links
   are allowed. Grey hierarchy lines do not participate in scoring.
3. A solid **Supports** arrow `A → B` means A supports B. Its share is part of B's
   incoming support budget. A dashed **Prerequisite for** arrow means A is a
   condition for B. Assess that condition as unknown/met/unmet; it does not check
   or uncheck the native task. Multiple prerequisites are AND conditions.
4. Select a node to give its intrinsic value (0–100), ignoring its value as a
   means to other goals. Zero is an explicit assessment; blank is unknown. An
   unassessed, unconnected node is not placed at the bottom of a ranking.
5. The Importance tab shows intrinsic/support contributions and, once the
   participating network is calibrated, relative weights. Click a row for the
   downstream causes and a small sensitivity check. Search, hierarchy collapse,
   view depth and node positions change visibility, never the calculation scope.
6. Use Scenario settings for a time horizon, intended change and support
   influence. Different scenarios have separate ratings, links and judgments.
   The default influence is 0.5; it can be set from 0 to 0.9. A new scenario starts
   empty and does not copy judgments invisibly.

For one target's 1–7 incoming support links, **Compare this goal's support
factors** offers optional local AHP pairwise judgments. Other/unlisted factors
are an explicit alternative, not an invisible normalization to 100%. All pairs
must be answered; inconsistent judgments (CR > 0.10) must be reconciled before
applying. Shares and the original judgments are written in one transaction.
Direct shares remain available for larger groups. This is local calibration,
**not a complete ANP implementation**. It makes no causal claims.

## Calculation and limits

`A[source,target] = support share`; `B` is intrinsic value. The direction of
importance propagation is the reverse of the displayed support arrow:

```
S = B + alpha * A * S
```

Each target's incoming support shares sum to at most 1. Unused share remains
unallocated. With `0 <= alpha <= 0.9`, the nonnegative iteration is a contraction
in the 1-norm and converges even with support-feedback loops. The calculation
sorts nodes/edges deterministically and stops at a small residual; results with
non-convergence or invalid allocations never become authoritative rankings.

Unanswered ratings/shares or unavailable endpoints make the network incomplete.
Known contributions can be inspected as **partial subtotals**, but there is no
full ranking or normalized weight. Unknown inputs are not assertions of zero.
When all explicit intrinsic values are zero, percentages remain unavailable.

Example, not default user data: health=30, speaking=20, career=50; health supports
career by 0.6, speaking by 0.4, alpha=0.5. Combined scores are 45/30/50, and weights
are 36%/24%/40%. These percentages are not completion, success probabilities,
causal effect estimates or instructions to allocate that percentage of time.

Prerequisites neither add score nor use native completion as a proxy. Local
prerequisite cycles are rejected; a cycle introduced by offline concurrent
edits is retained and flagged. The conflict set can include nodes downstream of
that cycle. Support loops are permitted. The first version does not model OR
conditions, numeric thresholds or automatic readiness propagation.

Sensitivity varies **only alpha by ±0.1**, bounded to [0,0.9], and reports rank
ranges. It is not Monte Carlo uncertainty over user ratings or proof that a
ranking is stable. Ties remain ties; no false decimal precision is promised.

Hierarchy lines never transmit value. Do not score the same fundamental value
again merely because it was split into children. This version does not allocate
an intrinsic-value budget across hierarchical children automatically. Inserting
intermediary scored nodes changes propagation length and can change results.
There is no automatic schedule, native priority change, JOBO-time-to-value
feedback, causal inference, or negative/inhibiting relationship in this version.

## Durable ownership, conflicts and backup

All content uses Jobu's existing `jobuRecords` immutable revision collection and
`createJobuData.transact`. Four version-1 **value** kinds are added:

| Kind | Content |
| --- | --- |
| `lifeNetworkScenario` | Name, horizon, alpha. Logical ID identifies the scenario. |
| `lifeNetworkValue` | Scenario ID, canonical node ID, nullable intrinsic value, note. |
| `lifeNetworkEdge` | Scenario ID, source, target, type, nullable share, condition, note. |
| `lifeNetworkJudgment` | Target, exact compared members, original pairwise judgments. |

No score, rank, UI position or analysis cache is persisted as decision content.
Edges/ratings have stable logical entity IDs and independent revision IDs.
Stale editor heads and stale pairwise populations fail atomically. Save failures
keep the draft; pending saves prevent navigation. Leaving a dirty network form
asks for confirmation. React state is published after commit, not before.

Removal creates a new tombstone revision. The underlying nodes and prior
revisions remain. Missing nodes are never reassigned by title. Their saved
relations and ratings are retained for recovery, with explicit cleanup controls.
A planned stage uses its stable stage ID before and after native-goal handoff.
If an unrelated native entity is subsequently associated differently, the app
flags any now-unavailable old identity instead of guessing its meaning.

The existing file and DB transports carry all immutable rows. Unrelated offline
edits union; two edits of one entity select the same deterministic latest head,
while both revisions remain recoverable. Separate offline support edits may
exceed a target's total budget: retain both and flag the conflict instead of
silently rescaling. Duplicate semantic entries imported under different entity
IDs are flagged, not double-counted. Edit or remove the conflicting relations;
raw imported duplicate assessments can be inspected/restored through History.

Use **Jobu's top-bar Backup / History** or a **whole-app backup** for this data.
The legacy notebook-only export covers the notebook, not this network. Native
tasks/goals still require a whole-app backup alongside personal revisions.
Import merges history; restoring an earlier value creates a new revision, not a
rewind. Reset already clears `jobu-personal-v1` together with the personal store.

Existing personal rows require no rewrite. Older Jobu builds which do not know
these new kinds reject them as unsupported instead of discarding them. **Update
all your own syncing Jobu clients together; do not mix this personal journal with
stock upstream clients or a production shared vault.** Take a full backup before
switching builds. Chinese and English copy is provided; other locale namespaces
currently use the English fallback with key parity.

## Verification

Pure-model tests cover reverse direction, the example, missing/zero, unused
budget, feedback convergence, deterministic input order, sensitivity, native
handoff identity and pairwise consistency. Store tests exercise strict reads,
atomic budget/cycle/stale guards, failed writes, immutable deletion, real
IndexedDB controllers, file/vault adapters, export and restore. Component tests
check translated output, incomplete ranks and read-only inspection. Browser
acceptance uses isolated synthetic data, not personal accounts or cloud sync.

Model background: alpha centrality (https://r.igraph.org/reference/alpha_centrality.html)
and local AHP judgments (https://www.superdecisions.com/tutorials/). These are
references for the method, not a claim of full ANP equivalence.
