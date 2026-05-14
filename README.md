# Web Terminal

A secure web-based terminal interface with directory browsing. Access your terminal and files from any browser on your network.

## Features

- 🖥️ Full terminal access via browser using xterm.js
- 📁 Directory browser with folder navigation
- 🔐 Secure authentication with SQLite database
- 🔑 Password reset with auto-generate option
- 👁️ Password reveal toggle
- 📱 Mobile-responsive design

## Installation

```bash
npm install
```

## Configuration

Create `.env` file:

```env
# Server port (default: 3456)
PORT=3456

# Workspace directory (default: current directory)
WORKSPACE_DIR=C:\\path\\to\\workspace

# Database path (optional)
DB_PATH=./terminal.db
```

Default login credentials:
- Email: `admin@mail.com`
- Password: `admin123`

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

## Usage

### Option 1: Python GUI Launcher (Recommended)

Double-click `launcher.py` or run:

```bash
python launcher.py
```

Features:
- 🎨 Modern GUI with settings panel
- 🔌 Automatic port conflict detection with kill option
- 🔒 Prevents Windows sleep while server is running
- 📊 Real-time logs and status monitoring

### Option 2: CLI Launcher

Interactive mode:
```bash
node launcher-cli.js
```

Start with options:
```bash
# Start with direct Node.js
node launcher-cli.js start --direct --port 3456

# Start with PM2
node launcher-cli.js start --pm2 --port 3456

# Stop server
node launcher-cli.js stop

# Check status
node launcher-cli.js status

# View logs (PM2 only)
node launcher-cli.js logs
```

### Option 4: Direct Node.js

```bash
npm start
```

Or with custom port:
```bash
PORT=3456 HOST=localhost npm start
```

### Option 4: PM2 Process Manager

```bash
# Start with PM2
pm2 start ecosystem.config.cjs

# Or via npm script
npm run pm2:start

# Monitor
pm2 monit

# View logs
pm2 logs terminal-web-ui

# Stop
pm2 stop ecosystem.config.cjs

# Restart
pm2 restart ecosystem.config.cjs
```

Then open http://localhost:3456 in your browser.

## Port Conflict Resolution

Both the Python GUI launcher and CLI launcher will detect if the port is already in use:

- **GUI Launcher**: Shows a dialog asking if you want to kill the process
- **CLI Launcher**: Prompts interactively or use `--force` to auto-kill

To manually kill a process on a port:

**Windows:**
```cmd
# Find process
netstat -ano | findstr :3456

# Kill by PID
taskkill /F /PID <PID>
```

**Linux/Mac:**
```bash
# Find and kill
lsof -ti:3456 | xargs kill -9
```

## Troubleshooting

### Server Unreachable When PC is Locked

If you can't access the web terminal after locking your computer, this is due to Windows power management:

**The launcher now automatically prevents sleep while the server is running**, but if issues persist:

1. **Check Windows Power Settings:**
   - Settings > System > Power > Screen and sleep timeouts
   - Set "When plugged in, PC goes to sleep after" to "Never"

2. **Disable Network Adapter Power Saving:**
   - Device Manager > Network adapters > Your Wi-Fi/Ethernet adapter
   - Properties > Power Management
   - Uncheck "Allow the computer to turn off this device to save power"

3. **For Network Access (non-localhost):**
   - Make sure Windows Firewall allows the port you're using
   - Run Windows Firewall > Advanced Settings > Inbound Rules > New Rule
   - Allow TCP port (e.g., 3456) for your Node.js server

### Port Already in Use

If you see "Port X is already in use":

1. The launcher will prompt you to kill the process
2. Click "Yes" to stop the existing process
3. The server will then start automatically

Or manually:
```bash
# CLI
node launcher-cli.js stop

# PM2
pm2 stop ecosystem.config.cjs

# Or find and kill
# Windows: netstat -ano | findstr :3456  then taskkill /F /PID <pid>
# Linux/Mac: lsof -ti:3456 | xargs kill -9
```

## Remote Access with ZeroTier

1. Install ZeroTier on your machine
2. Join a ZeroTier network
3. Access the web terminal from any device on the same ZeroTier network

## API

### Authentication Endpoints

- `POST /api/auth/login` - Login with credentials
- `POST /api/auth/logout` - Logout current session
- `POST /api/auth/validate` - Validate auth token
- `POST /api/auth/reset-password` - Reset user password

### WebSocket Messages

**Client → Server:**

- `{ type: 'auth_token', token: string }` - Authenticate with token
- `{ type: 'start_terminal', cwd?: string }` - Start new terminal session
- `{ type: 'terminal_input', data: string }` - Send input to terminal
- `{ type: 'resize_terminal', cols: number, rows: number }` - Resize terminal

**Server → Client:**

- `{ type: 'terminal_started', cwd: string }` - Terminal session started
- `{ type: 'terminal_output', data: string }` - Terminal output
- `{ type: 'terminal_exit' }` - Terminal session ended
- `{ type: 'error', message: string }` - Error occurred

### Browse Endpoints

- `GET /api/browse?path=/path/to/dir` - List directory contents

## Security

- Passwords hashed with bcrypt
- Session tokens expire after 30 days
- All API routes protected with Bearer token auth
- Not designed for public internet exposure without additional security

## License

MIT