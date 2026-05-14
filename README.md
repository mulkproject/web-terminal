# CLI Web UI

A secure, modern web-based terminal and AI chat interface. Access your terminal, browse files, and chat with an AI coding agent from any browser on your network.

---

## 🚀 Quick Start

1. **Install Node dependencies:**
   ```bash
   npm install
   ```
2. **Choose your LLM provider** in `.env` (see [AI Agent & LLM Providers](#-ai-agent--llm-providers)):
   - **Ollama** (local, free) → `LLM_PROVIDER=ollama`
   - **NVIDIA NIM** (cloud API) → `LLM_PROVIDER=nvidia` + add your API key
3. **Run the app:**
   ```bash
   python launcher.py
   ```
4. Open [http://localhost:3456](http://localhost:3456) and log in with:
   - **Email:** `admin@mail.com`
   - **Password:** `admin123`

---

## ✨ Features

- 🖥️ **Full Terminal Access** — Browser-based terminal using `xterm.js` and `node-pty`
- 🤖 **AI Chat with PI Agent** — Conversational coding assistant powered by the **PI Coding Agent** SDK (`@earendil-works/pi-coding-agent`)
- 📝 **Rich Markdown Rendering** — Agent responses render headers, bold, italic, lists, code blocks, and links in real time
- 🔊 **Text-to-Speech (TTS)** — Edge-TTS integration; click the speaker icon on any agent message to hear it spoken aloud
- 📁 **Directory Browser** — Navigate folders, view file details, and open files directly in the terminal
- 📷 **Image Upload** — Share screenshots and images in chat; the agent can analyze them
- 🔐 **Secure Authentication** — SQLite-backed user system with bcrypt password hashing and JWT sessions
- 🔄 **Persistent Chat Sessions** — Conversations are saved to the database and survive page refreshes
- 📱 **Mobile-Responsive Design** — Works on desktop, tablet, and phone
- 🌐 **WebSocket Real-Time Updates** — Chat, terminal, and file browser updates stream instantly

---

## 🤖 AI Agent & LLM Providers

### AI Agent Engine: PI Coding Agent

This project uses the **PI Coding Agent** by [Earendil Works](https://github.com/earendil-works) as the default chat backend.

- **Package:** `@earendil-works/pi-coding-agent`
- **What it does:** PI Agent is a conversational coding assistant that can analyze code, suggest improvements, explain concepts, and help debug issues. It supports multi-turn sessions with memory of the working directory and uploaded images.
- **Sessions:** Each chat session maps to a PI Agent session file stored in `pi-agent-sessions/`. Sessions persist across server restarts.

### Supported LLM Providers

| Provider | Type | Setup |
|----------|------|-------|
| **Ollama** | Local (free) | Install [Ollama](https://ollama.com/), pull a model (e.g., `llama3.2`), and leave `OLLAMA_HOST` at the default `http://localhost:11434` |
| **NVIDIA NIM** | Cloud API | Get a free API key from [build.nvidia.com](https://build.nvidia.com/) and set `NVIDIA_API_KEY` |

Switch providers by editing `.env`:

```env
# Use local Ollama
LLM_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434

# Or use NVIDIA NIM
LLM_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-your-key-here
```

> **Note:** The PI Agent auto-detects available models. If Ollama is unreachable, make sure the Ollama server is running (`ollama serve`).

---

## 📦 Installation

```bash
npm install
```

### Prerequisites

- **Node.js** v18+ (v20+ recommended)
- **Python 3.8+** (for the GUI launcher and Edge-TTS worker)
- **Ollama** (optional, for local LLM)
- **Edge-TTS Python package** (optional, for TTS):
  ```bash
  pip install edge-tts
  ```

---

## ⚙️ Configuration

A clean `.env` file is included in this release. Open it and fill in your credentials:

```env
# Server
SERVER_HOST=localhost
SERVER_PORT=3456

# LLM Provider
LLM_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434

# NVIDIA (optional)
NVIDIA_API_KEY=your-nvidia-api-key-here

# AI Agent
AGENT_ENGINE=pi

# Auth
JWT_SECRET=change-this-to-a-random-secret-string
ADMIN_EMAIL=admin@mail.com
ADMIN_PASSWORD=admin123

# Database
DB_PATH=./terminal.db
```

> **⚠️ Security Warning:** Never commit the real `.env` file to version control. The included `.gitignore` already protects it.

### Default Login Credentials

- **Email:** `admin@mail.com`
- **Password:** `admin123`

You can change the admin password after logging in, or modify `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` before first launch.

---

## 🚀 How to Run

### Step 1: Install Dependencies

```bash
npm install
```

> This only needs to be done once (or after `package.json` changes).

---

### Option 1: Python GUI Launcher (Recommended)

Double-click `launcher.py` or run from the terminal:

```bash
python launcher.py
```

**What `launcher.py` does:**
- 🎨 Opens a modern dark-themed GUI window
- 🔌 Detects if the port is already in use and offers to kill the existing process
- 🔒 Calls the Windows API to **prevent your PC from sleeping** while the server is running
- 📊 Shows real-time server logs, status indicators, and a settings editor
- 🌐 Auto-opens `http://localhost:3456` in your default browser once ready

**GUI Controls:**
- **Start Server** — launches the Node.js backend
- **Stop Server** — gracefully shuts down
- **Settings** — edit `.env` values directly in the GUI
- **Logs** — view live server output
- **Browser** — open the web UI

> **Windows users:** If Python is not in your PATH, use `py launcher.py` instead.

### Option 2: Direct Node.js

```bash
npm start
```

Or with a custom port:

```bash
SERVER_PORT=8080 npm start
```

Then open [http://localhost:3456](http://localhost:3456) in your browser.

---

## 🗂️ Project Structure

```
cli-web-ui/
├── public/
│   ├── index.html          # Main SPA shell
│   ├── css/
│   │   └── style.css       # All UI styling
│   └── js/
│       └── app.js          # Frontend logic (terminal, chat, browser)
├── server.js               # Express + WebSocket server
├── database.js             # SQLite schema and auth helpers
├── pi-agent-adapter.js     # PI Agent SDK bridge
├── seed-admin.js           # One-time admin seeder
├── edge-tts.py             # Edge-TTS Python worker
├── launcher.py             # Python GUI launcher
├── terminal.db             # Pre-seeded SQLite database (admin@mail.com / admin123)
├── .env                    # Environment template (no secrets)
└── package.json
```

---

## 🌐 WebSocket API (Quick Reference)

The frontend communicates with the backend via WebSocket for real-time features.

**Authentication:**
```json
{ "type": "auth_token", "token": "your-jwt-token" }
```

**Chat — Send Message:**
```json
{ "type": "chat_send", "sessionId": "uuid", "message": "Hello", "attachments": [] }
```

**Chat — Stream Delta:**
```json
{ "type": "chat_stream_delta", "sessionId": "uuid", "delta": "partial text" }
```

**Chat — Stream Complete:**
```json
{ "type": "chat_stream_complete", "sessionId": "uuid", "content": "full response" }
```

**Terminal — Start:**
```json
{ "type": "start_terminal", "cwd": "." }
```

**Terminal — Input:**
```json
{ "type": "terminal_input", "data": "ls -la\r" }
```

**Browse — List Directory:**
```json
{ "type": "browse_request", "path": "/path/to/dir" }
```

Full REST + WebSocket documentation is available in `CHAT_API.md`.

---

## 🔊 Text-to-Speech (TTS)

Every agent response includes a **speaker icon** (🔊). Click it to generate speech via Microsoft Edge TTS.

- The backend streams audio generation progress so you know when playback is ready.
- File paths inside code blocks are preserved during TTS cleanup so spoken paths remain accurate.
- Markdown syntax (stars, backticks, brackets) is stripped before speaking so the voice output is clean.

Make sure `edge-tts` is installed:
```bash
pip install edge-tts
```

---

## 🛡️ Security Notes

- Passwords are hashed with **bcrypt** (salted, 10 rounds).
- JWT tokens expire after **30 days**.
- All API and WebSocket routes require a valid **Bearer token**.
- This tool is designed for **local network / trusted environment** use. Do not expose directly to the public internet without a reverse proxy and HTTPS.

---

## 🛠️ Troubleshooting

### "Port 3456 is already in use"

The Python launcher will detect this and show a dialog to kill the old process. Click **Yes**.

Or manually:

```cmd
# Windows
netstat -ano | findstr :3456
taskkill /F /PID <PID>
```

### Server Unreachable After Locking PC

The Python launcher calls the Windows API to keep the system awake. If issues persist:

1. **Windows Settings** → System → Power → set sleep to **Never** when plugged in.
2. **Device Manager** → Network adapters → your adapter → Power Management → uncheck *"Allow the computer to turn off this device to save power"*.

### Ollama Not Responding

Make sure Ollama is running:
```bash
ollama serve
# In another terminal:
ollama pull llama3.2
```

### TTS Not Working

Verify Python and `edge-tts` are installed:
```bash
python --version
pip install edge-tts
```

---

## 📄 License

MIT