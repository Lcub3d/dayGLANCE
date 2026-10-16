# Settings redesign

Status: design, agreed with the owner 2026-10-14. Tracks #2075 (the quick part
shipped as #2078).

## Goals

- **Organized, not crowded.** One topic at a time; nothing on screen that the
  user has not switched on.
- **Room to grow.** A new feature adds a page or a card, never another block in
  a long column.
- **One definition of each setting.** Desktop and mobile show the same page
  components; today the same settings are written twice (`SettingsModal.jsx`,
  about 2,850 lines, and `MobileSettingsPanel.jsx`, about 3,500).
- **No behaviour change while moving.** Every setting keeps its storage key,
  its sync behaviour and its side effects; the redesign moves controls, it
  does not reinterpret them. The two deliberate behaviour changes (theme
  "System", sync cards that pause instead of forget) are separate, named steps.

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚙ Settings                                                        ✕ │
├───────────────────┬──────────────────────────────────────────────────┤
│ 🔍 Search…        │  Sync                                            │
│                   │                                                  │
│   General         │  ┌────────────────────────────────────────────┐  │
│   Appearance      │  │ ☁ Cloud Sync (WebDAV)              [ ON ] │  │
│   Features        │  │   Synced 2 min ago                         │  │
│   Notifications   │  │   Server  https://cloud.example.com/dav    │  │
│   AI              │  │   …                                        │  │
│ ▸ Sync          ● │  └────────────────────────────────────────────┘  │
│   Integrations    │  ┌────────────────────────────────────────────┐  │
│   Backup & Restore│  │ 🗄 GLANCEvault                     [ off ] │  │
│                   │  │   Paused · your connection is kept         │  │
│   About & Help    │  └────────────────────────────────────────────┘  │
│                   │                                                  │
└───────────────────┴──────────────────────────────────────────────────┘
```

- A dialog that uses the screen: wide on desktop (the #2078 sizes are the
  floor), the topic list fixed on the left, only the right side scrolls.
- The header keeps the title and Close; Escape closes (`useModalClose`).
- The last topic opened is remembered on this device.
- A dot on a topic marks something that needs attention (a sync error, an
  integration that lost access).
- Below a width where two panes do not fit (tablet portrait), the dialog shows
  the topic list first and drills into a page, as mobile does.

## Topics and where every current setting goes

| Topic | Contents | Today |
|---|---|---|
| **General** | Language; clock format; first day of week; home timezone; end of day; sounds; weather (on/off, location, unit); daily tips & quotes; Inbox (auto-archive) and Follow-ups after Sounds; global shortcuts (desktop, last) | Localization, Sound, Weather, Daily Content, Global Shortcuts blocks |
| **Appearance** | Theme (Light / Dark / System); default view on load; views on this device; timeline size; tablet view defaults; GLANCE tab default | View Defaults, Tablet View Defaults, timeline size; theme from the header |
| **Features** | One card each with its own switch: Goals & Projects, Routines, Habits, Multi-user (with the roster); an **Experimental** group last: JOBO, Aspire | Goals & Projects, Routines, Habit Tracking, Inbox, Experimental, Multi-user blocks |
| **AI Features** | One card: provider, key, model, then each AI feature, all off by default and locked until the provider has a key (Ollama needs none). The rest of the app asks `aiFeatureOn` in `src/ai.js`, so a feature saved on before that rule counts only once there is a key, and AI switched on with every feature off changes nothing | AI Features block |
| **Sync** | End-to-end encryption, WebDAV, GLANCEvault, Direct Access, Network proxy (desktop, #2082) and the private-address grants, iCloud (Apple only), each saving on its own (a card's Save and Cancel show while it has unsaved changes; `sync/syncFormPlan.js` keeps the encryption flag and the WebDAV connection, which share one stored object, from overwriting each other); Sync diagnostics last | Cloud Sync block |
| **Integrations** | One card each: Calendars (CalDAV task calendar, ICS feeds, device calendars, file import), Obsidian, Todoist, TRMNL, GLANCE apps (intents), Local Integrations (MCP), Android Automation (Android only) | Calendar Sync, Obsidian, Todoist, TRMNL, GLANCE Integrations, Local Integrations, Automation Intents blocks |
| **Notifications** | Cards: Reminders, Weekly Review, hyperGLANCE Sessions (each with its own switch) | The header bell's dialog |
| **Backup & Restore** | Auto-Backup as one card holding cards for Local Backups and Remote Backups (each with a switch), Folder Backup (web only, its own connect / disconnect) and Backup history (restore and delete); then Export, Restore and Reset as one row | The header save icon's menu and the auto-backup manager |
| **About & Help** | Version and update check; help; send feedback; privacy policy and terms | Update banner, help modal links |

Multi-user is a card under Features rather than its own topic: it is a mode
the user switches on, with a roster that only matters once it is on, which is
exactly the Features pattern.

Pages that cannot apply are not shown: Android Automation off Android, iCloud
off Apple platforms, global shortcuts off desktop.

## The card pattern

Features, Sync and Integrations are lists of **cards**, and every card works
the same way:

```
┌─────────────────────────────────────────────┐
│ ☁ Cloud Sync (WebDAV)              [ ON ]  │  ← title and switch, always shown
│   Synced 2 min ago                          │  ← one status line, only when on
│   …settings…                                │  ← only when on
│   [Test connection]          [Disconnect]   │
└─────────────────────────────────────────────┘
```

- **Off hides everything but the title, the switch and a one-line summary.**
  A user with one sync channel sees one open card.
- **Off pauses; it does not forget.** Turning a card off stops it and keeps its
  configuration, so turning it back on resumes where it was. Forgetting is a
  separate, explicit **Disconnect** (or **Remove**) action with a confirmation.
  This is a behaviour change for GLANCEvault, whose switch today saves `null`
  (`CloudSyncSettingsForm.jsx` → `setVaultConfig(null)`) and so deletes the
  URL, token and account id, and resets the key cache and sync cursors. See
  "Pausing a sync channel" below; every card is audited for the same thing.
- **Several cards can be on at once.** WebDAV and GLANCEvault already run side
  by side for some users; the switches are independent, never a choice of one.
- **Status, not chrome.** The status line carries what the header dots carry
  today (last synced, the error, "paused"), so the page answers "is it
  working?" without opening anything.

## Header

Nine icons today; seven after. Three of the seven only appear when their
feature is set up, so a user with none of them sees four (settings, Day Dial,
theme, help).

| Icon | Decision |
|---|---|
| Cloud sync | **Stays**: live status and click-to-sync; shown only when sync is set up |
| Obsidian | **Stays**: live vault status and click-to-sync; shown only when a vault is connected |
| MCP bolt | **Stays**: live status, and its panel holds the kill switch and the session's undo list, which must stay one click away when an agent misbehaves (the MCP spec's settings-cluster rule) |
| Settings | Stays |
| Notifications (bell) | **Moves** to Settings → Notifications |
| Day Dial | **Stays**: it opens a view, not a setting |
| Theme | **Stays** as the one-click Light/Dark switch; Theme also appears under Appearance with System. When the theme follows the system, the header button switches to an explicit Light or Dark (the opposite of what is showing) |
| Backup (save icon) | **Moves** to Settings → Backup & Restore |
| Help (?) | **Stays**: new users look for help before they look in Settings |

## Theme: System

dayGLANCE stores a boolean (`day-planner-darkmode`). The new setting is
`light | dark | system`, with System following `prefers-color-scheme` and
updating live when the OS changes. lastGLANCE shipped the same; follow its
storage and migration so the apps agree.

What has to keep working, because each reads the boolean today:

- the tray popup (reads `day-planner-darkmode` on mount, `App.jsx` ~2093);
- `SubscriptionWall.jsx`;
- `deviceSettings.js` (the setting is device-local and must stay so);
- Electron's window background before first paint (`main.ts`, `nativeTheme`).

The boolean stays as the resolved value ("is it dark right now") so those
readers keep working; the preference is stored beside it. A device with no
preference keeps its current explicit Light or Dark, so nobody's theme changes
on update.

## Pausing a sync channel

Each channel needs an `enabled` flag that is separate from its configuration:

- **GLANCEvault**: store `{ enabled: false, vaultUrl, vaultToken, accountId }`
  instead of `null`. Every reader of the vault config must test `enabled`, not
  presence; that list is audited and covered by tests before the switch
  changes. Pausing should not reset the key cache or the sync cursors (they
  describe the same link, still valid on resume); changing the URL, token or
  account still resets them, as today. Disconnect is today's off.
- **Cloud Sync (WebDAV)**: already keeps its config on disable; confirm and
  pin it with a test.
- **Integrations**: Obsidian, Todoist, TRMNL, calendars and the rest are audited
  for the same rule in their step.

### Integrations audit (step 2)

Every integration is a card, so the page reads as one list. A card has a
switch only where off can safely mean pause; the others are **static cards**:
the same frame, title and status dot, with their on and off inside.

| Integration | Today | Card |
|---|---|---|
| TRMNL | `trmnlConfig.enabled` beside the webhook and key; off keeps both | **Card.** Off pauses; on with no webhook opens the form until one is entered |
| Android Automation | one boolean, no configuration | **Card** |
| Obsidian | off is Disconnect: `setObsidianConfig(null)` forgets the vault | **Static card** (no switch) for now. A pause needs `enabled: false` with the vault kept, and every reader of `obsidianConfig` (the hook, the plugin bridge, the header dot) audited first, as GLANCEvault was |
| Calendars | several independent sources (task calendar URL, ICS feeds, device calendars), no single switch | **Static card**: a switch would have to mean "all of them" |
| Todoist | its own component with its own connect / disconnect | **Static card** around its own connect / disconnect |
| GLANCE apps (intents) | WebDAV log and GLANCEvault intents, two separate switches | **Static card**, for the same reason as Calendars |
| Local Integrations (MCP) | its own component with its own kill switch | **Static card**: its switches stay inside, because turning MCP on must go through its consent dialog |

## Mobile

The mobile Settings tab keeps its **nine quick tiles** in their 3 × 3 grid, as
they are: 24-hour clock, week start, sound, theme, Frames, Goals, Routines,
Habits, AI. The theme tile cycles Light → Dark → System. The tiles are
shortcuts, not the only home of a setting: each also lives on its page.

If a tile is ever added or removed, the grid stays a full rectangle (multiples
of three).

Below the tiles, the list of rows becomes the same topics as desktop, and each
row opens the same page component desktop shows on the right. Mobile-only
pages that already exist as `variant="page"` (Todoist, Local Integrations)
become the shared implementation.

Done: the rows are the topics this device shows, each opening its page from
`useSettingsSections`, the same sections the dialog draws. Syncing calendars
stays a row above them (an action, not a page), and Help & Feedback a row
below them (the phone's `?`). Frames, Routines and Habits keep their own
screens, which their tiles open. What only a phone had moved into the shared
sections behind the same conditions: the Location block on General (phones
have no header weather), the phone's view defaults on Appearance
(`mobileViewDefaults`), the iOS Live Activity card on Notifications, and the
native Obsidian vault actions (an Android phone picks the folder in the app's
settings; every native app disconnects through its bridge).

The cards that only native devices show are `SettingsCard`s too: iCloud sync
(Apple) is a switch card; Direct Access (Android, iOS, desktop) is a card
whose switch appears once a folder is connected, with its contents kept while
off (`contentsWhenOff`) for changing the folder and disconnecting, and its
encryption as a card inside it; Automation intents (Android) is a switch card
whose warning is its summary, read before it is turned on. Card titles wrap
rather than truncate, so a long one reads whole on a phone.

## Search

A search box at the top of the topic list. Each page declares its keywords
(the strings of its own labels, plus synonyms such as "dark" for Theme); a
match lists the pages with the matching setting named, and choosing one opens
the page scrolled to it. Strings stay in the `settings.*` locale prefix, so
search works in every language.

## Deep links

`openSettings(topic, anchor?)` opens Settings at a page. Used by:

- a sync error toast and the header sync dot → Sync;
- the MCP status bolt → Integrations → Local Integrations;
- the Obsidian header dot → Integrations → Obsidian;
- existing "fix in settings" links on mobile.

Done (`src/components/settings/settingsLink.js`): `openSettings` is on the
app context. On desktop it opens the dialog at the topic; on a phone it opens
the Settings tab on the topic's page. Either side reads the link once, scrolls
to the section, opens the section's card if it starts folded, and clears it,
so later visits open where the user left off. The links:

- the header cloud and Obsidian buttons open Sync and Integrations → Obsidian
  while their dot is red (an error, or a lost vault), and sync otherwise;
- the MCP status modal links to Integrations → Local Integrations;
- the Obsidian error toast has a Settings link to Integrations → Obsidian;
- the calendar button, with nothing set up, opens Integrations → Calendar Sync;
- the mobile timezone notice opens General.

There is no cloud sync error toast; the header dot is that surface.

## Order of work

Each step is one or more PRs, each shippable on its own.

1. **Shell and topics, contents unchanged.** The two-pane dialog and the topic
   list, with today's blocks moved onto the pages verbatim, one topic per PR.
   Each page is its own component under `src/components/settings/`, taking the
   `variant="page"` shape. `SettingsModal.jsx` shrinks as each topic leaves.
   Tests per page: it renders, its controls are present, and its storage keys
   are untouched. Notifications and Backup & Restore join here; their header
   icons go when their pages land.
   Done for desktop: each topic is a hook under
   `src/components/settings/topics/` (`useGeneralTopic`, `useSyncTopic`, ...)
   returning its sections, and `SettingsModal.jsx` only gathers them and draws
   the shell. They are hooks rather than page components because the topic
   list, its dots and search need every topic's `show` without rendering it,
   and a form's unsaved edits have to survive switching topics. The one piece
   of state two topics share, the GLANCE apps WebDAV form (Integrations edits
   it, the multi-user card reads it), is `useIntentForm`, held once by the
   dialog. Step 4 calls the same hooks from mobile.
2. **Cards.** Sync first (with pausing, including the GLANCEvault change), then
   Integrations, then Features.
3. **Theme: System**, with the migration above.
4. **Mobile on the shared pages.** Tiles unchanged; the rows open the shared
   page components; `MobileSettingsPanel.jsx` shrinks the same way.
5. **Search, topic dots, deep links, remembered topic.**

`locales.test.js` keeps every new string covered in all ten languages.

## Out of scope

- New settings. The redesign moves and groups; features ship separately.
- Changing what any setting does, beyond the two named behaviour changes.
- Cross-device sync of settings that are device-local today.
