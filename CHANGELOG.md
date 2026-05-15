# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-15

### Fixed (Critical)
- **Removed Hardcoded llama3.2 Default** — ELIMINATED all hardcoded `llama3.2` references that caused "Model not available" errors
  - **Root Cause**: Code was defaulting to `llama3.2` everywhere, causing reconnect failures when user didn't have that model
  - **Solution**: Now fetches available models from Ollama API (`/api/tags`) and uses first available
  - **Files Changed**: `server.js` (8 locations), `pi-agent-adapter.js` (2 locations)
  - **Error Messages**: No longer suggests `llama3.2` specifically - uses generic "check available models" message
  - **Affected Flows**: Session reconnect, new session creation, connection test, status check

### Fixed
- **Multi-Session Streaming** — Fixed cross-session streaming leak where agent responses appeared in wrong sessions
  - Each session now properly isolated with session-specific event handlers
  - Streaming events correctly routed to their originating session only
  
- **Typing Indicator Persistence** — Fixed "Generating Response..." indicator disappearing after first message
  - Made typing indicator session-specific with `_hasTypingIndicator` flag
  - Added `checkAndRestoreTypingIndicator()` when switching back to active session
  - Indicator now persists until agent finishes, even when switching between sessions

- **Token Counter** — Fixed token usage not updating
  - Token updates now properly matched to generating sessions
  - Display updates for the active session being viewed

- **Mobile Sidebar** — Fixed hamburger menu on login screen and sidebar not collapsing
  - Hidden on login screen, shows after authentication
  - Added swipe-to-close gesture (swipe left on sidebar)

### Added
- **OpenCode Zen Provider** — Full support for OpenCode Zen AI gateway
  - Added to launcher.py with UI configuration
  - 5 free tier models: DeepSeek V4 Flash, MiniMax M2.5, Ring 2.6 1T, Nemotron 3 Super, Big Pickle
  - Environment variables: `OPENCODE_ZEN_API_KEY`, `OPENCODE_ZEN_MODEL`

## [1.1.3] - 2026-05-15

### Fixed
- **Mobile Sidebar Issues** — Fixed critical mobile UI bugs:
  - Sidebar toggle hamburger menu (☰) now properly hidden on login screen
  - Changed auth-screen to use `position: fixed` with `z-index: 1000` to properly cover entire viewport
  - Updated CSS selectors to use `.show` class instead of checking inline styles
  - Added JS initialization: `sidebarToggle.style.display = 'none'` on page load  
  - Toggle now only shows after successful login
  - Fixed auth screen visibility management using CSS classes (.show) for more reliable hiding
  - Added swipe-to-close gesture for mobile sidebar (swipe left to close)
  - Added both `click` and `touchend` event listeners for better PWA/mobile support

### Added
- **OpenCode Zen Support in Launcher** — The Python GUI launcher now supports OpenCode Zen:
  - Added "✨ OpenCode Zen (Cloud)" radio button option in LLM Provider settings
  - Added OpenCode Zen API Key configuration card with input field
  - Added test connection button for OpenCode Zen
  - Settings are saved to both JSON config and `.env` file
  - Added `OPENCODE_ZEN_API_KEY` and `OPENCODE_ZEN_MODEL` environment variables
  - Shows free tier model availability in connection test

## [1.1.2] - 2026-05-15

### Fixed
- **Message Queuing** — Fixed "Agent is already processing" error when sending follow-up messages while agent is working
  - Removed blocking `_sending` flag check that was rejecting new messages
  - Added PI SDK's `streamingBehavior` option with `'followUp'` mode for automatic message queuing
  - Messages now queue automatically when agent is busy, no longer block users
  - Added visual notification when message is queued

### Added
- **Agent Activity Display (TUI-like)** — Users can now see what the agent is doing during streaming, just like the PI Agent terminal TUI
  - Shows "Agent is working..." status indicator when agent starts processing
  - Shows real-time thinking/reasoning steps with 🤔 indicator
  - Shows tool execution start/end with progress indicators
  - Activity indicators auto-clean up when stream completes
  - Added new WebSocket events: `agent_status`, `agent_thinking`
  - Added CSS animations for agent activity (pulsing indicators, spinners)

## [1.1.1] - 2026-05-15

### Fixed
- **Multi-Session Stability** — Fixed critical bug where opening a new chat session would cause existing active sessions to stop. 
  - Root cause: All PI Agent sessions were sharing the same session persistence directory, causing session state files to collide
  - Solution: Each session now gets its own unique subdirectory (`PI_SESSION_DIR/session-{sessionId}/`)
  - Sessions are now properly isolated and can run concurrently without interference

## [1.1.0] - 2026-05-15

### Added
- **OpenCode Zen Provider** — Added support for OpenCode Zen AI gateway as a new LLM provider
  - 30+ curated models including GPT, Claude, Gemini, Qwen, Kimi, GLM, MiniMax
  - 5 free tier models: DeepSeek V4 Flash, MiniMax M2.5, Ring 2.6 1T, Nemotron 3 Super, Big Pickle
  - OpenAI-compatible API at `https://opencode.ai/zen/v1`
  - Automatic model validation and caching
  - Get API key from: https://opencode.ai/zen
- **New Environment Variables**:
  - `OPENCODE_ZEN_API_KEY` — Your OpenCode Zen API key
  - `OPENCODE_ZEN_MODEL` — Default model (optional, defaults to `deepseek-v4-flash-free`)
  - Update `LLM_PROVIDER=opencode-zen` to use OpenCode Zen

### Changed
- **API `/api/chat/config`** — Now includes OpenCode Zen in available providers list
- **API `/api/chat/models`** — Supports fetching OpenCode Zen models
- **API `/api/chat/status`** — Shows OpenCode Zen configuration status
- **WebSocket `chat_session_create`** — Supports `opencode-zen` as provider option

## [1.0.1] - 2026-05-15

### Fixed
- **Ollama 404 Error** — Fixed "404 status code (no body)" error when using Ollama as the LLM provider. The PI SDK was internally calling `/v1/models` (which doesn't exist in Ollama's OpenAI-compatible API). Now treated as generic OpenAI-compatible provider.

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
