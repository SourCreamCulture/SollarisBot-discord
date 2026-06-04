# SollarisBot

A Discord bot built with Node.js and TypeScript for a private server. It currently supports music playback plus Apex Legends account linking and stats lookups.

## Features

- `/apex link`, `/apex unlink`, `/apex me`
- `/apex member`, `/apex lookup`, `/apex legend`
- `/bot status` for uptime, ping, memory, and music queue health
- `/play now <query>` for YouTube searches, URLs, and Spotify playlist imports
- `/play next <query>` to put a track or playlist right after the current song
- `/library favorite ...` for personal saved tracks
- `/library playlist ...` for shared server playlists
- Playlist and favorite autocomplete while typing command options
- `/player pause`, `/player resume`, `/player skip`, `/player stop`, `/player leave`
- `/player now`, `/player seek`, `/player replay`, `/player volume`, `/player loop`, `/player autoplay`
- `/queue view`, `/queue jump`, `/queue move`, `/queue remove`, `/queue clear`, `/queue shuffle`, `/queue history`
- `/player voteskip` for shared listener-driven skips
- `/music settings ...` for persistent server music settings
- One queue per guild
- Voice-channel guardrails and friendly error messages
- Optional DJ role restrictions for playback controls
- Optional bound text channel for music commands
- Optional 24/7 mode with queue-state restore on restart
- Persistent default volume and vote-skip settings
- Persistent personal favorites and server playlists

## Requirements

- Node.js 22 or newer
- A Discord application and bot token
- A Discord guild for development command registration
- An Apex stats provider API key:
  - Recommended while waiting on Tracker approval: [Apex Legends Status / Mozambique API](https://apexlegendsapi.com/)
  - Optional later fallback: [Tracker Network developer API key](https://tracker.gg/developers)

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
   - `APEX_LINKS_FILE` controls where Discord-to-Apex links are stored on disk.
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

- Live playback is runtime state, but queue recovery metadata is persisted locally so 24/7 mode can restore the bot after a restart.
- Server music settings are persisted locally in the JSON file configured by `MUSIC_SETTINGS_FILE`.
- Music favorites and playlists are persisted locally in the JSON file configured by `MUSIC_LIBRARY_FILE`.
- Queue recovery metadata is persisted locally in the JSON file configured by `MUSIC_QUEUE_STATE_FILE`.
- Linked Apex accounts are persisted locally in the JSON file configured by `APEX_LINKS_FILE`.
- `discord-player-youtubei` is used for YouTube support because `discord-player` v7 no longer ships YouTube support in the default extractor bundle.
- Streaming from YouTube may have Terms of Service implications. Review the relevant policies before wider use.
