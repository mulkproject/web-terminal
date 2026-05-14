# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-14

### Added
- **PI Coding Agent** — Replaced Copilot SDK with `@earendil-works/pi-coding-agent` as the default AI backend
- **Edge-TTS Integration** — Click the speaker icon on any agent message to hear it spoken via Microsoft Edge TTS
- **Rich Markdown Streaming** — Agent responses now render headers, bold, italic, lists, code blocks, and links in real time as they stream
- **Image Upload in Chat** — Share screenshots; the PI Agent can analyze them
- **Persistent Chat Sessions** — Sessions survive page refreshes and server restarts
- **`.env` Configuration** — All settings (port, LLM provider, auth) are now managed through environment variables
- **Seed Admin Script** — `seed-admin.js` for one-time admin account creation
- **Build Script** — `build-launcher-exe.bat` for bundling the Python launcher into an `.exe`
- **API Documentation** — `CHAT_API.md` with full WebSocket + REST reference

### Changed
- **LLM Providers** — Now supports **Ollama** (local/free) and **NVIDIA NIM** (cloud API) via `.env`
- **Launcher** — Consolidated to a single Python GUI launcher (`launcher.py`) with port detection, sleep prevention, and settings editor
- **Frontend** — Major UI polish: always-visible TTS button, visible resend icon, proper markdown formatting on first load

### Fixed
- **Disappearing Agent Responses** — Fixed a bug where sending a new message while the agent was streaming would destroy the active response bubble
- **Live Markdown Formatting** — Responses now format correctly as they arrive instead of showing as a single unbroken line
- **TTS Button Visibility** — Speaker icon is now always visible (not just on hover)
- **Resend Button Visibility** — Fixed resend icon color on user chat bubbles
- **TTS Path Preservation** — File paths inside code blocks are no longer stripped during text-to-speech cleanup

### Removed
- `cli.js` — Old CLI interface
- `launcher-cli.js` — Old Node.js CLI launcher
- `launcher-tui.js` — Old Node.js TUI launcher
- `copilot-cli-adapter.js` — Old Copilot SDK adapter
- `config.json` — Replaced by `.env`
- `launcher-config.json` — Replaced by `.env`
- `ecosystem.config.cjs` — PM2 config no longer needed for basic usage

---

## [1.0.0-alpha] - 2026-05-01

### Added
- Initial alpha release
- Web-based terminal interface using xterm.js
- Directory browser with folder navigation
- Secure authentication with SQLite database
- Password reset with auto-generate option
- Password reveal toggle
- Mobile-responsive design with PWA support
- Image upload and gallery
- Dark mode support
- Multiple launcher options:
  - Python GUI Launcher (`launcher.py` / `Web-Terminal-Launcher.exe`)
  - Interactive TUI (`launcher-tui.js`)
  - CLI Launcher (`launcher-cli.js`)
  - Direct Node.js (`node server.js`)
- Port conflict detection with kill option in all launchers
- Windows sleep prevention while server is running
- Real-time server logs in GUI and TUI
- Settings editor in GUI and TUI
- Chat assistant feature (optional, can be enabled/disabled)
- Chat session management (create, delete, with SDK cleanup)
- Working directory display in chat tabs
- Right-click chat tab to show working directory path
- Default admin account: `admin@mail.com` / `admin123`
- Offline mode support with pre-installed dependencies

### Known Issues (Alpha)
- `@github/copilot-sdk` is not bundled; must be installed separately for chat functionality
- Native modules (`better-sqlite3`, `node-pty`) require matching Node.js ABI version on target machine
- TUI settings navigation may require arrow keys + Enter to confirm changes
- PWA install prompt may not appear on all browsers consistently

### Security Notes
- Change default admin credentials immediately after first login
- Not designed for public internet exposure without reverse proxy/HTTPS
- Session tokens expire after 30 days
