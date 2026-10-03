# SollarisBot

A Discord bot built with Node.js and TypeScript for a private server. It currently supports music playback plus Apex Legends and Valorant account linking and stats lookups.

## Features

- `/apex link`, `/apex unlink`, `/apex me`
- `/apex member`, `/apex lookup`, `/apex legend`
- `/apex map`, `/apex rank`, `/apex compare`, `/apex squad`, `/apex watch`
- `/valorant agent`, `/valorant map`, `/valorant weapon`, `/valorant random-agent`, `/valorant random-comp`, `/valorant strat`
- `/valorant link`, `/valorant unlink`, `/valorant me`, `/valorant profile`, `/valorant rank`, `/valorant matches`, `/valorant match`, `/valorant stats`
- `/valorant leaderboard`, `/valorant lfg`, `/valorant team-balance`
- Optional persistent Valorant ranked leaderboard embed that refreshes every 10 minutes
- `/bot status` for uptime, ping, memory, and music queue health
- `/bot help` with Music, Games, Utilities, and Administration categories
- `/settings` for persistent per-guild channels, roles, scheduling, and leaderboard configuration
- `/bot changelog` for recent bot updates
- `/play now <query>` for YouTube searches, URLs, and Spotify playlist imports
- `/play next <query>` to put a track or playlist right after the current song
- `/play random favorite` and `/play random playlist` for saved-track roulette
- `/library favorite ...` for personal saved tracks
- `/library playlist ...` for shared server playlists
- `/library playlist export` for a shareable text list of playlist links
- Playlist and favorite autocomplete while typing command options
- `/player pause`, `/player resume`, `/player skip`, `/player stop`, `/player leave`
- `/player now`, `/player lyrics`, `/player seek`, `/player replay`, `/player volume`, `/player loop`, `/player autoplay`, `/player radio`
- Music panel buttons for favorite, vote skip, replay, queue again, and saving the current track to a playlist
- `/queue view`, `/queue jump`, `/queue move`, `/queue remove`, `/queue clear`, `/queue shuffle`, `/queue dedupe`, `/queue save`, `/queue history`
- `/queue upvote` and `/queue downvote` for listener-driven queue ordering
- `/player voteskip` for shared listener-driven skips
- `/music settings ...` for persistent server music settings and saved queue cleanup
- `/music stats me`, `/music stats server`, `/music top tracks`, `/music top artists`
- `/poll`, `/remind`, `/roll`, and `/event` for lightweight server utilities
- Event edit/cancel controls, RSVP limits, timezone-aware scheduling, and automatic attendee reminders
- Interactive Apex and Valorant LFG posts with Join/Leave/Close controls, open-slot counts, and automatic expiry
- Reminder cancellation and persistent delivery retries
- One queue per guild
- Voice-channel guardrails and friendly error messages
- Optional DJ role restrictions for playback controls
- Optional bound text channel for music commands
- Optional 24/7 mode with recent queue-state restore on restart
- Persistent default volume and vote-skip settings
- Persistent personal favorites and server playlists

## Requirements

- Node.js 22 or newer
- A Discord application and bot token
- A Discord guild for development command registration
- An Apex stats provider API key:
  - Recommended while waiting on Tracker approval: [Apex Legends Status / Mozambique API](https://apexlegendsapi.com/)
  - Optional later fallback: [Tracker Network developer API key](https://tracker.gg/developers)
- A [HenrikDev API key](https://api.henrikdev.xyz/dashboard/) for Valorant account, rank, and match commands

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill it in:

   ```bash
   cp .env.example .env
   ```

   Apex setup notes:
   - `APEX_STATS_PROVIDER` controls the active provider. Use `mozambique` now, or `tracker` once Tracker approves your app.
   - `MOZAMBIQUE_API_KEY` is required when `APEX_STATS_PROVIDER=mozambique`.
   - `TRACKER_API_KEY` is required when `APEX_STATS_PROVIDER=tracker`.
   - Tracker developer keys may still need to be whitelisted before API calls work. If Tracker lookups return `401 Unauthorized`, request API access/whitelisting through Tracker's developer support flow.
   - `HENRIKDEV_API_KEY` is required for `/valorant link`, `/valorant me`, `/valorant profile`, `/valorant rank`, `/valorant matches`, `/valorant match`, `/valorant stats`, `/valorant leaderboard`, `/valorant lfg` rank lookup, and `/valorant team-balance`.
   - `/valorant agent`, `/valorant map`, `/valorant weapon`, `/valorant random-agent`, `/valorant random-comp`, and `/valorant strat` use public Valorant-API game data and do not require a key.
   - Configure the persistent ranked leaderboard in Discord with `/settings leaderboard channel:#ranked refresh-minutes:10`. It edits the same message and filters linked users by that guild’s membership. Legacy `VALORANT_LEADERBOARD_CHANNEL_ID` and `VALORANT_LEADERBOARD_REFRESH_INTERVAL_MS` values are migrated once at startup if that guild has no saved settings. After migration, Discord settings take precedence, including disabling the leaderboard.

- `APEX_LINKS_FILE` controls where Discord-to-Apex links are stored on disk.
- `APEX_WATCH_FILE` controls where Apex watch snapshots are stored on disk.
- `VALORANT_LINKS_FILE` controls where Discord-to-Valorant links are stored on disk.
- `VALORANT_LEADERBOARD_STATE_FILE` controls where the persistent Valorant leaderboard message ID is stored on disk.
- This first release only supports PC Apex lookups.

3. Register slash commands:

   ```bash
   npm run deploy:commands
   ```

4. Start the bot in development:

   ```bash
   npm run dev
   ```

5. Build for production:

   ```bash
   npm run build
   npm start
   ```

6. Convert saved Spotify track entries in the music library to matched YouTube URLs:

   ```bash
   npm run migrate:spotify-library
   ```

## Configure each server in Discord

Members with **Manage Server** permission can configure their guild without changing `.env` or restarting:

- `/settings view` — show timezone, command channels/roles, and scheduling defaults.
- `/settings channel target:event channel:#game-nights` — bind a command family to a text channel. Omit `channel` to remove the binding. Targets: `apex`, `valorant`, `lfg`, `event`, `poll`, `remind`, `roll`. The `lfg` target applies to both `/apex lfg` and `/valorant lfg`; other game commands use their game's target. Buttons obey the same restrictions.
- `/settings role target:lfg role:@Players` — require a role. Omit `role` to clear it. Server managers bypass role requirements.
- `/settings timezone zone:America/New_York` — interpret local event/reminder dates in this timezone. The default is UTC. An explicit ISO offset overrides the default; ambiguous or nonexistent daylight-saving wall times require an explicit offset.
- `/settings event-reminder minutes:15` — default reminder lead time for **new** events; `0` disables reminders.
- `/settings lfg-expiry minutes:60` — default lifetime for **new** LFG posts.
- `/settings leaderboard channel:#ranked refresh-minutes:10` — enable/configure the persistent Valorant leaderboard. Omit `channel` to disable it. Changes are picked up within a minute.
- `/music settings bind-channel`, `unbind-channel`, `dj-role`, `clear-dj-role`, `default-volume`, `voteskip`, `voteskip-threshold`, and `twenty-four-seven` manage existing guild music settings.
- `/music settings panel-persistence enabled:true` — reuse saved music-panel messages after a restart. Defaults to enabled for every guild; no server IDs are built into the code. Set `false` to stop restoring panel references.

Settings and help commands remain usable in any channel so admins can remove a stale channel restriction. Credentials, storage paths, and deployment/runtime defaults remain environment configuration.

### Events, squads, and reminders

Use `/event create title:"Ranked Night" starts:"2026-12-05 20:00" timezone:America/New_York limit:5 reminder-minutes:15` (choose a future date). Attendees toggle their RSVP with the button, and reminders mention only the attendees. `/event list` and event footers show the ID; `/event edit id:…` and `/event cancel id:…` also offer autocomplete. The creator or a server manager can edit/cancel. Set `limit:0` for unlimited RSVPs. Rescheduling resets attendee notification state; changing server defaults does not alter existing events.

Use `/valorant lfg` or `/apex lfg` to post a squad. The host occupies one slot; `needed` specifies additional teammates. Members use Join/Leave, and the host uses Close. Posts and membership persist across restarts. Expired posts reject further changes immediately; controls are disabled by the scheduler within 30 seconds while the bot is online.

Use `/remind me when:2h30m message:"Take a break"`, `/remind list`, and `/remind cancel id:…`. Absolute times and `tomorrow` (09:00) use the server timezone. Lists and cancellation are scoped to the requesting member and guild. Failed deliveries stay saved and retry with backoff (up to one hour) until delivered or cancelled. Delivery is at least once: a crash after sending but before saving acknowledgement can produce a duplicate. Notifications overdue during downtime are sent when the bot returns; event reminders only send before the event starts.

After updating, run `npm run deploy:commands`, `npm run build`, and restart the bot to expose the new slash commands. Use `/bot help` to explore them.

## Notes

- Live playback is runtime state, but queue recovery metadata is persisted locally so 24/7 mode can restore the bot after a recent restart. Snapshots older than `MUSIC_QUEUE_RESTORE_MAX_AGE_MS` are pruned at startup; the default is 24 hours, and `0` disables automatic restore.
- Server music settings are persisted locally in the JSON file configured by `MUSIC_SETTINGS_FILE`.
- Music favorites and playlists are persisted locally in the JSON file configured by `MUSIC_LIBRARY_FILE`.
- Music listening stats are persisted locally in the JSON file configured by `MUSIC_STATS_FILE`.
- Queue recovery metadata is persisted locally in the JSON file configured by `MUSIC_QUEUE_STATE_FILE`; admins can clear the current server's saved snapshot with `/music settings clear-saved-queue`.
- Linked Apex accounts are persisted locally in the JSON file configured by `APEX_LINKS_FILE`.
- Linked Valorant accounts are persisted locally in the JSON file configured by `VALORANT_LINKS_FILE`.
- The persistent Valorant leaderboard message reference is persisted locally in the JSON file configured by `VALORANT_LEADERBOARD_STATE_FILE`.
- Polls, reminders, and events are persisted locally in the JSON file configured by `UTILITY_STORE_FILE`.
- `discord-player-youtubei` is used for YouTube support because `discord-player` v7 no longer ships YouTube support in the default extractor bundle.
- Streaming from YouTube may have Terms of Service implications. Review the relevant policies before wider use.
