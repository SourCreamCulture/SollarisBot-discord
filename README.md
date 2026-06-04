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
   - `VALORANT_LEADERBOARD_CHANNEL_ID` enables the persistent ranked leaderboard embed. It edits the same message when possible, refreshes according to `VALORANT_LEADERBOARD_REFRESH_INTERVAL_MS`, and includes newly linked users on each refresh.

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
