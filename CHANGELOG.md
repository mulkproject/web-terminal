# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
