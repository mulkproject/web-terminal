# Web Terminal

![Version](https://img.shields.io/badge/version-1.0.0--alpha-blue)
![License](https://img.shields.io/badge/license-MIT-green)

A secure web-based terminal interface with directory browsing, chat assistant, and file management. Access your terminal and files from any browser on your network.

> **Alpha Release:** This is an early release for testing and feedback. Features may change, and bugs may exist. Please report issues via GitHub Issues.

## What's Included in This Release

This is the **source code release** for GitHub. For the standalone offline distribution (with `.exe` and pre-installed `node_modules`), see the [Releases](https://github.com/yourusername/web-terminal/releases) page.

| File | Description |
|------|-------------|
| `server.js` | Main web server (start directly with `node server.js`) |
| `launcher.py` | Python GUI Launcher source (build your own `.exe`) |
| `launcher-tui.js` | Interactive Terminal UI — Run with `node launcher-tui.js` |
| `launcher-cli.js` | Command-line launcher — Scriptable/automation |
| `database.js` | SQLite database module |
| `copilot-cli-adapter.js` | Copilot SDK CLI adapter |
| `cli.js` | Command-line interface |
| `terminal.db` | Fresh SQLite database with default admin account |
| `config.json` | App configuration (port, chat toggle, etc.) |
| `launcher-config.json` | Launcher preferences |
| `public/` | Web frontend files |

## Default Login Credentials

- **Email:** `admin@mail.com`
- **Password:** `admin123`

> **Security Note:** Change the default password after first login.

## Installing Dependencies

This is a source release. Install dependencies first:

```bash
npm install
```

> **Note:** The GitHub Copilot SDK (`@github/copilot-sdk`) is a private package and is not included. If you need chat functionality, install it separately after setting up GitHub package authentication.

## Quick Start

### Option 1: Python GUI Launcher

```bash
python launcher.py
```

- Automatically detects and resolves port conflicts
- Prevents Windows sleep while running
- Real-time server logs in the GUI
- Settings editor built-in

Then open http://localhost:3456 in your browser.

You can also build a standalone `.exe` using PyInstaller:
```bash
pyinstaller --onefile --noconsole --name Web-Terminal-Launcher --icon icon.ico launcher.py
```

### Option 2: Interactive TUI (Terminal UI)

```bash
node launcher-tui.js
```

- Full interactive dashboard in your terminal
- Visual port conflict detection with kill option
- Live log viewer
- Built-in settings editor (navigate with arrow keys)
- Keyboard shortcuts: **S** Start/Stop, **L** Logs, **R** Refresh, **Q** Quit

### Option 3: CLI Launcher

```bash
# Interactive mode
node launcher-cli.js

# Direct start
node launcher-cli.js start --direct --port 3456

# Stop server
node launcher-cli.js stop

# Check status
node launcher-cli.js status
```

### Option 4: Direct Node.js

```bash
node server.js
```

Or with a custom port:
```bash
PORT=8080 node server.js
```

## Features

- 🖥️ Full terminal access via browser using xterm.js
- 📁 Directory browser with folder navigation
- 💬 **Chat assistant** (optional, can be enabled/disabled)
- 🔐 Secure authentication with SQLite database
- 📱 Mobile-responsive design with PWA support
- 🔑 Password reset with auto-generate option
- 👁️ Password reveal toggle
- 🌙 Dark mode
- 📤 Image upload and gallery
- 🚀 Multiple launcher options (GUI, TUI, CLI, Direct)

## Chat Feature

The chat assistant is **enabled by default**. To disable it:

### Via Launcher GUI/TUI
Open the settings panel and toggle **Chat** off.

### Via Config File
Edit `config.json`:
```json
{
  "port": 3456,
  "chat_enabled": false
}
```

### Via Environment Variable
```bash
CHAT_ENABLED=false node server.js
```

> **Note:** Chat requires the GitHub Copilot SDK (`@github/copilot-sdk`). The SDK is a private GitHub package that requires authentication. If the SDK is not installed, the app will still run fine — chat will simply be unavailable even if enabled.
>
> To add Copilot chat support, install the SDK:
> ```bash
> npm install @github/copilot-sdk
> ```
> Then restart the server.

## Configuration

### `config.json` (Application)
```json
{
  "port": 3456,
  "host": "localhost",
  "chat_enabled": true,
  "theme": "dark"
}
```

### `launcher-config.json` (Launcher)
```json
{
  "port": 3456,
  "host": "localhost",
  "auto_open_browser": true,
  "prevent_sleep": true,
  "chat_enabled": true
}
```

### Environment Variables (`.env`)
Create a `.env` file for advanced settings:
```env
# Server port (default: 3456)
PORT=3456

# Host to bind (default: localhost, use 0.0.0.0 for network access)
HOST=localhost

# Workspace directory (default: current directory)
WORKSPACE_DIR=C:\\path\\to\\workspace

# Database path (default: ./terminal.db)
DB_PATH=./terminal.db

# Enable/disable chat (default: true)
CHAT_ENABLED=true

# GitHub token for Copilot chat (optional)
GITHUB_TOKEN=your_github_token_here
```

## Launcher Comparison

| Feature | Python GUI | TUI (Terminal) | CLI | Direct |
|---------|------------|----------------|-----|--------|
| Interactive Interface | ✅ GUI | ✅ Terminal UI | ❌ Command line | ❌ |
| Port Conflict Detection | ✅ Dialog | ✅ Visual | ✅ Text | ❌ |
| Port Kill Option | ✅ Yes | ✅ Yes | ✅ Yes | Manual |
| Real-time Logs | ✅ Yes | ✅ Yes | PM2 only | Terminal |
| Settings Editor | ✅ GUI | ✅ TUI | Command args | .env file |
| Prevents Sleep | ✅ Yes | ✅ (via server) | ✅ (via server) | No |
| Best For | Desktop use | SSH/Terminal | Scripts | Development |

## Port Conflict Resolution

All launchers detect if the port is already in use:

- **GUI Launcher**: Shows a dialog asking if you want to kill the process
- **TUI**: Highlights the conflict and offers to kill the process
- **CLI Launcher**: Prompts interactively or use `--force` to auto-kill

To manually kill a process on a port:

**Windows:**
```cmd
netstat -ano | findstr :3456
taskkill /F /PID <PID>
```

**Linux/Mac:**
```bash
lsof -ti:3456 | xargs kill -9
```

## Troubleshooting

### Server Won't Start

1. Check if the port is already in use — the launcher will show this
2. Make sure Node.js is installed: `node --version`
3. If dependencies are missing, run `npm install` again.

### Server Unreachable When PC is Locked

The launcher automatically prevents sleep while the server is running. If issues persist:

1. **Check Windows Power Settings:**
   - Settings > System > Power > Screen and sleep timeouts
   - Set "When plugged in, PC goes to sleep after" to "Never"

2. **Disable Network Adapter Power Saving:**
   - Device Manager > Network adapters > Your adapter
   - Properties > Power Management
   - Uncheck "Allow the computer to turn off this device to save power"

3. **Allow the port through Windows Firewall** if accessing from another device.

### Chat Not Working

1. Check that `chat_enabled` is `true` in `config.json`
2. The Copilot SDK (`@github/copilot-sdk`) is not included in this release. Install it separately:
   ```bash
   npm install @github/copilot-sdk
   ```
3. Ensure you have a valid `GITHUB_TOKEN` in `.env` if using Copilot models.

## Security

- Passwords are hashed with bcrypt
- Session tokens expire after 30 days
- All API routes are protected with Bearer token auth
- **Not designed for public internet exposure** without additional security measures (reverse proxy, HTTPS, etc.)
- Change the default `admin@mail.com` / `admin123` credentials immediately

## Requirements

- **Node.js** 18+ (required for server and all launchers)
- **Python 3.x** (for the GUI launcher)
- Modern web browser

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please read [CHANGELOG.md](CHANGELOG.md) for version history.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

**Release Version:** v1.0.0-alpha  
**Release Date:** 2026-05-01  
**Status:** Alpha — for testing and feedback
