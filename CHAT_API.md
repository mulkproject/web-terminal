# Web Terminal — API Documentation

## Overview

This document covers all APIs provided by the Web Terminal server, including Chat, File Browsing, Terminal, and general system endpoints. Chat supports both the GitHub Copilot SDK and Ollama (BYOK) as backend providers. Real-time updates for Chat and Terminal are delivered through WebSockets.

**Base URL:** `http://localhost:3456` (or your configured server host/port)  
**Authentication:** All endpoints require a `Bearer` token in the `Authorization` header.

---

## Table of Contents

1. [REST Endpoints](#rest-endpoints)
   - [GET /api/health](#get-apihealth)
   - [GET /api/status](#get-apistatus)
   - [POST /api/auth/login](#post-apiauthlogin)
   - [POST /api/auth/logout](#post-apiauthlogout)
   - [GET /api/auth/validate](#get-apiauthvalidate)
   - [POST /api/auth/reset-password](#post-apiauthreset-password)
   - [POST /api/auth/change-email](#post-apiauthchange-email)
   - [GET /api/auth/me](#get-apiauthme)
   - [GET /api/commands](#get-apicommands)
   - [POST /api/commands](#post-apicommands)
   - [PUT /api/commands/:id](#put-apicommandsid)
   - [DELETE /api/commands/:id](#delete-apicommandsid)
   - [POST /api/upload-image](#post-apiupload-image)
   - [GET /api/images/*](#get-apiimages)
   - [GET /api/chat/status](#get-apichatstatus)
   - [GET /api/chat/models](#get-apichatmodels)
   - [GET /api/chat/ollama-health](#get-apichatollama-health)
   - [POST /api/chat/test-connection](#post-apichattest-connection)
   - [POST /api/chat/init](#post-apichatinit)
   - [POST /api/chat/send](#post-apichatsend)
   - [GET /api/chat/history](#get-apichathistory)
   - [POST /api/chat/clear](#post-apichatclear)
   - [GET /api/chat/sessions](#get-apichatsessions)
   - [GET /api/chat/sessions/:sessionId](#get-apichatsessionssessionid)
   - [DELETE /api/chat/sessions/:sessionId](#delete-apichatsessionssessionid)
   - [POST /api/chat/sessions/:sessionId/resume](#post-apichatsessionssessionidresume)
   - [GET /api/chat/sdk-sessions](#get-apichatsdk-sessions)
   - [PUT /api/chat/sessions/:sessionId/summary](#put-apichatsessionssessionidsummary)
   - [GET /api/terminals/available](#get-api-terminals-available)
   - [GET /api/browse](#get-apibrowse)
   - [POST /api/terminal/open](#post-api-terminalopen)
2. [WebSocket Events](#websocket-events)
   - [Connection](#connection)
   - [Authentication — Client → Server](#authentication--client--server)
   - [Authentication — Server → Client](#authentication--server--client)
   - [Chat — Client → Server](#chat--client--server)
   - [Chat — Server → Client](#chat--server--client)
   - [File Browsing — Client → Server](#file-browsing--client--server)
   - [File Browsing — Server → Client](#file-browsing--server--client)
   - [Terminal — Client → Server](#terminal--client--server)
   - [Terminal — Server → Client](#terminal--server--client)
   - [System / Ping](#system--ping)
3. [Data Models](#data-models)
4. [Error Handling](#error-handling)

---

## REST Endpoints

### GET /api/health

Returns basic health information about the server.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 12345,
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### GET /api/status

Returns a detailed status report including connection information, active sessions, and feature flags.

**Response:**
```json
{
  "status": "running",
  "activeSessions": 5,
  "activeTerminals": 2,
  "model": "gemini-2.5-pro",
  "features": {
    "fileBrowsing": true,
    "terminal": true,
    "chat": true,
    "imageUpload": true
  }
}
```

### POST /api/auth/login

Authenticates a user and returns a JWT token.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "username": "user",
  "password": "pass"
}
```

**Response (Success):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "user",
    "email": "user@example.com",
    "isAdmin": false
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

### POST /api/auth/logout

Logs out the current user and invalidates the session/token.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### GET /api/auth/validate

Validates the provided Bearer token and returns user info.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (Success):**
```json
{
  "valid": true,
  "user": {
    "id": 1,
    "username": "user",
    "email": "user@example.com",
    "isAdmin": false
  }
}
```

### POST /api/auth/reset-password

Requests a password reset.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password reset email sent"
}
```

### POST /api/auth/change-email

Changes the authenticated user's email address.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "newEmail": "new@example.com",
  "password": "currentPassword"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email updated successfully"
}
```

### GET /api/auth/me

Returns the current authenticated user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 1,
  "username": "user",
  "email": "user@example.com",
  "isAdmin": false,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

### GET /api/commands

Returns all saved custom commands.

**Response:**
```json
{
  "success": true,
  "commands": [
    {
      "id": 1,
      "name": "Docker PS",
      "command": "docker ps",
      "description": "List running containers",
      "category": "docker",
      "icon": "docker",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/commands

Creates a new custom command.

**Request Body:**
```json
{
  "name": "Docker PS",
  "command": "docker ps",
  "description": "List running containers",
  "category": "docker",
  "icon": "docker"
}
```

**Response:**
```json
{
  "success": true,
  "command": {
    "id": 1,
    "name": "Docker PS",
    "command": "docker ps",
    "description": "List running containers",
    "category": "docker",
    "icon": "docker",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### PUT /api/commands/:id

Updates an existing custom command.

**Request Body:**
```json
{
  "name": "Updated Name",
  "command": "docker ps -a",
  "description": "List all containers",
  "category": "docker",
  "icon": "docker"
}
```

**Response:**
```json
{
  "success": true,
  "command": {
    "id": 1,
    "name": "Updated Name",
    "command": "docker ps -a",
    "description": "List all containers",
    "category": "docker",
    "icon": "docker"
  }
}
```

### DELETE /api/commands/:id

Deletes a custom command.

**Response:**
```json
{
  "success": true,
  "message": "Command deleted"
}
```

### POST /api/upload-image

Uploads an image file to be referenced in chat messages.

**Headers:**
```
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

**Form Data:**
- `file`: Image file (JPEG, PNG, GIF, WebP)

**Response:**
```json
{
  "success": true,
  "imageUrl": "/api/images/1704067200000_filename.jpg",
  "filename": "filename.jpg"
}
```

### GET /api/images/*

Serves uploaded images by path. The path follows `/api/images/{timestamp}_{filename}`.

**Response:** Binary image data with appropriate `Content-Type` header.

### GET /api/chat/status

Check the overall status of the chat feature for the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "copilotAvailable": true,
  "hasSession": true,
  "messageCount": 12,
  "ollamaConfigured": true,
  "ollamaHost": "http://localhost:11434",
  "ollamaModel": "llama3.2",
  "availableModels": ["llama3.2", "codellama", "mistral"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on 200 |
| `copilotAvailable` | boolean | Whether the Copilot SDK client is initialized |
| `hasSession` | boolean | Whether the user has an active in-memory session |
| `messageCount` | number | Number of messages in the current active session history |
| `ollamaConfigured` | boolean | Whether `OLLAMA_HOST` is set |
| `ollamaHost` | string \| null | The configured Ollama URL |
| `ollamaModel` | string | Default model name to use |
| `availableModels` | string[] | List of locally available Ollama models |

---

### GET /api/chat/models

List all available AI models. Queries Ollama if configured; otherwise returns a hardcoded fallback list.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "models": [
    { "id": "llama3.2", "name": "Llama 3.2", "type": "ollama", "size": 2019371264 },
    { "id": "codellama", "name": "CodeLlama", "type": "ollama" }
  ],
  "provider": {
    "type": "ollama",
    "url": "http://localhost:11434"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `models[].id` | string | Model identifier used when initializing sessions |
| `models[].name` | string | Human-readable model name |
| `models[].type` | string | Provider type (`ollama`, `github`, etc.) |
| `models[].size` | number \| undefined | Model file size in bytes (Ollama only) |

---

### GET /api/chat/ollama-health

Perform a direct health check against the configured Ollama server.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200 — Healthy:**
```json
{
  "success": true,
  "reachable": true,
  "message": "Ollama is reachable (3 models)",
  "models": [
    { "name": "llama3.2", "size": 2019371264, "modified_at": "2025-04-01T12:00:00Z" }
  ],
  "url": "http://localhost:11434"
}
```

**Response 200 — Unreachable:**
```json
{
  "success": false,
  "reachable": false,
  "message": "Cannot connect to Ollama: connect ECONNREFUSED",
  "error": "connect ECONNREFUSED",
  "hint": "Make sure Ollama is running and the URL is correct"
}
```

---

### POST /api/chat/test-connection

Create a temporary Copilot SDK session and send a test message to verify the full pipeline works.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "model": "llama3.2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | No | Model to test with. Defaults to `llama3.2` or first available model |

**Response 200 — Success:**
```json
{
  "success": true,
  "message": "Connection successful",
  "model": "llama3.2",
  "provider": "byok"
}
```

**Response 503 — Ollama Unavailable:**
```json
{
  "success": false,
  "message": "Cannot reach Ollama server: connect ECONNREFUSED. Please check if Ollama is running and the URL is correct.",
  "stage": "ollama_connection"
}
```

**Response 503 — Copilot Not Initialized:**
```json
{
  "success": false,
  "message": "Copilot client not initialized"
}
```

---

### POST /api/chat/init

Initialize a new Copilot SDK chat session for the authenticated user. Any existing in-memory sessions for the user are disconnected first.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "model": "llama3.2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | No | Model name to use for the session |

**Response 200:**
```json
{
  "success": true,
  "message": "Chat session initialized",
  "model": "llama3.2",
  "sessionId": "sdk-session-uuid-123",
  "history": []
}
```

**Response 503 — SDK Not Installed:**
```json
{
  "success": false,
  "message": "Copilot SDK not installed. Run: npm install @github/copilot-sdk"
}
```

---

### POST /api/chat/send

Send a user message to the active Copilot SDK session. If no session exists, one is auto-initialized.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "message": "How do I list all files in a directory?",
  "sessionId": "sdk-session-uuid-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | **Yes** | The message text to send |
| `sessionId` | string | No | Target SDK session ID. If omitted, the first available session is used |

**Response 200:**
```json
{
  "success": true,
  "message": "Message sent",
  "sessionId": "sdk-session-uuid-123"
}
```

**Note:** The actual assistant response is delivered asynchronously via WebSocket (`chat_stream_delta` → `chat_stream_complete`).

---

### GET /api/chat/history

Retrieve the chat history from the database for the user's active session.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "sessionId": "db-session-id-456",
  "isActive": true,
  "history": [
    { "role": "user", "content": "Hello", "timestamp": 1714521600000 },
    { "role": "assistant", "content": "Hi! How can I help?", "timestamp": 1714521605000 }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string \| null | Database session ID |
| `isActive` | boolean | Whether an in-memory session exists |
| `history` | ChatMessage[] | Up to 100 recent messages |

---

### POST /api/chat/clear

Disconnect and clear all in-memory chat sessions for the authenticated user. Database records are preserved unless explicitly deleted.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "message": "Chat history cleared"
}
```

---

### GET /api/chat/sessions

List all persisted chat sessions for the authenticated user, including their messages and active status.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max sessions to return (capped at 50) |

**Response 200:**
```json
{
  "success": true,
  "sessions": [
    {
      "serverSessionId": "db-session-id-456",
      "clientSessionId": "sdk-session-uuid-123",
      "name": "My Session",
      "model": "llama3.2",
      "provider": "ollama",
      "sdkSessionId": "sdk-session-uuid-123",
      "workingDirectory": "/workspace",
      "summary": "Helped with file operations",
      "createdAt": "2025-04-01T10:00:00Z",
      "lastActivity": "2025-04-01T10:30:00Z",
      "isActive": true,
      "messageCount": 12,
      "messages": [
        { "role": "user", "content": "Hello", "timestamp": 1714521600000 }
      ]
    }
  ]
}
```

---

### GET /api/chat/sessions/:sessionId

Get detailed information and full message history for a specific database session.

**Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Database session ID (`serverSessionId`) |

**Response 200:**
```json
{
  "success": true,
  "session": {
    "id": "db-session-id-456",
    "name": "My Session",
    "model": "llama3.2",
    "provider": "ollama",
    "sdkSessionId": "sdk-session-uuid-123",
    "summary": "Helped with file operations",
    "createdAt": "2025-04-01T10:00:00Z",
    "lastActivity": "2025-04-01T10:30:00Z",
    "isActive": true,
    "messages": [
      { "role": "user", "content": "Hello", "timestamp": 1714521600000 }
    ]
  }
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "Session not found"
}
```

---

### DELETE /api/chat/sessions/:sessionId

Deletes a specific chat session from the database.

**Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Database session ID (`serverSessionId`) |

**Response 200:**
```json
{
  "success": true,
  "message": "Session deleted"
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "Session not found"
}
```

---

### POST /api/chat/sessions/:sessionId/resume

Resume a previously persisted chat session by reconnecting it to the Copilot SDK. Existing active sessions are disconnected first.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Database session ID to resume |

**Body:**
```json
{
  "model": "llama3.2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | No | Override model for the resumed session |

**Response 200:**
```json
{
  "success": true,
  "message": "Session resumed",
  "sessionId": "sdk-session-uuid-123",
  "sdkSessionId": "sdk-session-uuid-123",
  "history": [
    { "role": "user", "content": "Hello", "timestamp": 1714521600000 }
  ]
}
```

---

### GET /api/chat/sdk-sessions

List sessions known to the Copilot SDK itself (not the local database). Useful for debugging SDK state.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": "sdk-session-uuid-123",
      "startTime": "2025-04-01T10:00:00Z",
      "modifiedTime": "2025-04-01T10:30:00Z",
      "summary": "File operations help",
      "context": { ... }
    }
  ]
}
```

---

### PUT /api/chat/sessions/:sessionId/summary

Update the summary/title of a persisted chat session.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Database session ID |

**Body:**
```json
{
  "summary": "Helped with Docker setup"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `summary` | string | **Yes** | New summary text |

**Response 200:**
```json
{
  "success": true,
  "message": "Summary updated"
}
```

**Response 400:**
```json
{
  "success": false,
  "message": "Summary is required"
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "Session not found"
}
```

---

### GET /api/terminals/available

List all available terminal shells detected on the host system.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "terminals": [
    {
      "id": "pwsh",
      "name": "PowerShell Core",
      "command": "pwsh.exe",
      "args": [],
      "icon": "⚡",
      "description": "Modern cross-platform PowerShell",
      "recommended": true
    }
  ],
  "default": "pwsh"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `terminals[].id` | string | Shell identifier used in `start_terminal` |
| `terminals[].name` | string | Human-readable shell name |
| `terminals[].command` | string | Executable path or command |
| `terminals[].args` | string[] | Default arguments for the shell |
| `terminals[].icon` | string | Emoji icon for UI |
| `terminals[].description` | string | Short description |
| `terminals[].recommended` | boolean | Whether this is the recommended default |
| `default` | string | Recommended shell ID for the platform |

---

### GET /api/browse

List the contents of a directory. Hidden entries (starting with `.`) are excluded.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | `WORKSPACE_DIR` | Absolute or relative directory path to browse |

**Response 200:**
```json
{
  "success": true,
  "path": "C:\\Users\\master\\cli-web-ui",
  "parent": "C:\\Users\\master",
  "folders": [
    { "name": "public", "path": "C:\\Users\\master\\cli-web-ui\\public", "isDirectory": true }
  ],
  "files": [
    { "name": "server.js", "path": "C:\\Users\\master\\cli-web-ui\\server.js", "isDirectory": false }
  ],
  "isWorkspaceRoot": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Resolved absolute path of the browsed directory |
| `parent` | string \| null | Parent directory path (null if at filesystem root) |
| `folders` | BrowseEntry[] | Subdirectories, sorted alphabetically |
| `files` | BrowseEntry[] | Files, sorted alphabetically |
| `isWorkspaceRoot` | boolean | Whether this path equals the configured `WORKSPACE_DIR` |

**Response 200 — Error:**
```json
{
  "success": false,
  "error": "Path does not exist",
  "path": "/some/missing/path"
}
```

---

### POST /api/terminal/open

Validate that a path exists and can be opened in a terminal. Used by the UI before launching a terminal in a specific folder.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "path": "C:\\Users\\master\\cli-web-ui"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | **Yes** | Directory path to open |

**Response 200:**
```json
{
  "success": true,
  "path": "C:\\Users\\master\\cli-web-ui"
}
```

**Response 400:**
```json
{
  "success": false,
  "error": "Path required"
}
```

**Response 404:**
```json
{
  "success": false,
  "error": "Path does not exist"
}
```

---

## WebSocket Events

Chat streaming, file browsing, and terminal I/O are delivered through the existing WebSocket connection (`ws://localhost:3456`). All WebSocket messages are JSON objects with a `type` field.

### Connection

When a WebSocket connection is established, the server sends a `connected` message.

#### `connected` (Server → Client)

```json
{
  "type": "connected",
  "message": "WebSocket connected"
}
```

---

### Authentication — Client → Server

#### `auth`

Authenticate using username and password over WebSocket.

```json
{
  "type": "auth",
  "username": "user",
  "password": "pass"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | **Yes** | User's username |
| `password` | string | **Yes** | User's password |

---

#### `auth_token`

Authenticate using an existing JWT token.

```json
{
  "type": "auth_token",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | **Yes** | JWT token from REST login |

---

#### `logout`

Log out the currently authenticated user.

```json
{
  "type": "logout"
}
```

---

#### `reset_password`

Request a password reset.

```json
{
  "type": "reset_password",
  "email": "user@example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | **Yes** | Email address for reset |

---

### Authentication — Server → Client

#### `auth_success`

Authentication succeeded.

```json
{
  "type": "auth_success",
  "user": {
    "id": 1,
    "username": "user",
    "email": "user@example.com",
    "isAdmin": false
  }
}
```

---

#### `auth_failed`

Authentication failed.

```json
{
  "type": "auth_failed",
  "error": "Invalid credentials"
}
```

---

#### `logged_out`

User was logged out successfully.

```json
{
  "type": "logged_out",
  "message": "Logged out successfully"
}
```

---

#### `password_reset`

Password reset result.

```json
{
  "type": "password_reset",
  "success": true,
  "message": "Password reset email sent"
}
```

---

### Chat — Client → Server

#### `chat_init`

Initialize a new chat session via WebSocket (alternative to the REST `POST /api/chat/init`).

```json
{
  "type": "chat_init",
  "model": "llama3.2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | No | Model to use |

---

#### `chat_send`

Send a chat message via WebSocket.

```json
{
  "type": "chat_send",
  "message": "How do I create a new file?",
  "sessionId": "sdk-session-uuid-123",
  "imagePath": "/uploads/screenshot.png"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | **Yes** | Message text |
| `sessionId` | string | No | Target SDK session ID |
| `imagePath` | string | No | Optional image attachment path |

---

#### `chat_session_delete`

Delete a specific chat session from both the database and the Copilot SDK.

```json
{
  "type": "chat_session_delete",
  "sessionId": "client-session-id-abc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | **Yes** | Client/session ID to delete |

---

#### `chat_session_reconnect`

Reconnect to an existing SDK session after a page refresh.

```json
{
  "type": "chat_session_reconnect",
  "sessionId": "sdk-session-uuid-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | **Yes** | SDK session ID to reconnect |

---

#### `chat_command`

Send a slash command to the chat system.

```json
{
  "type": "chat_command",
  "command": "/clear"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | **Yes** | Command string (e.g. `/clear`, `/fix`, `/explain`) |

---

#### `chat_session_create`

Create a new chat session via WebSocket.

```json
{
  "type": "chat_session_create",
  "name": "New Session",
  "model": "llama3.2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Session display name |
| `model` | string | No | Model to use |

---

#### `chat_session_rename`

Rename an existing chat session.

```json
{
  "type": "chat_session_rename",
  "sessionId": "sdk-session-uuid-123",
  "name": "Renamed Session"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | **Yes** | Session ID to rename |
| `name` | string | **Yes** | New session name |

---

#### `chat_session_clear`

Clear all messages in a session without deleting the session itself.

```json
{
  "type": "chat_session_clear",
  "sessionId": "sdk-session-uuid-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | **Yes** | Session ID to clear |

---

#### `permission_response`

Respond to a permission request from a tool or agent.

```json
{
  "type": "permission_response",
  "requestId": "perm-req-123",
  "granted": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requestId` | string | **Yes** | Permission request ID |
| `granted` | boolean | **Yes** | Whether permission is granted |

---

#### `user_input_response`

Respond to a user-input prompt from a tool or agent.

```json
{
  "type": "user_input_response",
  "requestId": "input-req-456",
  "response": "Yes, proceed with the update"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requestId` | string | **Yes** | Input request ID |
| `response` | string | **Yes** | User's response text |

---

#### `chat_interrupt`

Interrupt an ongoing streaming chat response.

```json
{
  "type": "chat_interrupt",
  "sessionId": "sdk-session-uuid-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | No | Session ID to interrupt |

---

#### `chat_clear`

Clear all chat sessions and disconnect them.

```json
{
  "type": "chat_clear"
}
```

**Response:** `chat_cleared`

---

#### `get_session_info`

Request detailed information about the current or a specific session.

```json
{
  "type": "get_session_info",
  "sessionId": "sdk-session-uuid-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | No | Session ID to query (omit for current) |

---

#### `resume_session`

Resume a previously persisted session.

```json
{
  "type": "resume_session",
  "sessionId": "db-session-id-456"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | **Yes** | Database session ID to resume |

---

### Chat — Server → Client

#### `chat_session_created`

A new chat session was created successfully.

```json
{
  "type": "chat_session_created",
  "success": true,
  "clientSessionId": "client-session-123",
  "serverSessionId": "db-session-456",
  "sdkSessionId": "sdk-session-uuid-789",
  "name": "New Session",
  "model": "llama3.2",
  "workingDirectory": "/workspace/project",
  "history": []
}
```

---

#### `chat_session_renamed`

A chat session was renamed.

```json
{
  "type": "chat_session_renamed",
  "success": true,
  "clientSessionId": "client-session-123",
  "name": "Renamed Session"
}
```

---

#### `chat_session_cleared`

A chat session's messages were cleared.

```json
{
  "type": "chat_session_cleared",
  "success": true,
  "clientSessionId": "client-session-123"
}
```

---

#### `chat_message_sent`

Confirmation that a user message was received and saved.

```json
{
  "type": "chat_message_sent",
  "sessionId": "client-session-123",
  "message": "Hello!"
}
```

---

#### `chat_cleared`

All chat sessions have been cleared and disconnected.

```json
{
  "type": "chat_cleared",
  "success": true
}
```

---

#### `chat_message`

A complete assistant message has been received.

```json
{
  "type": "chat_message",
  "sessionId": "sdk-session-uuid-123",
  "role": "assistant",
  "content": "You can list files with `ls` or `dir`."
}
```

---

#### `chat_stream_delta`

A incremental chunk of the assistant's response (real-time streaming).

```json
{
  "type": "chat_stream_delta",
  "sessionId": "sdk-session-uuid-123",
  "delta": "You can list"
}
```

---

#### `chat_stream_complete`

The assistant has finished streaming the full response.

```json
{
  "type": "chat_stream_complete",
  "sessionId": "sdk-session-uuid-123"
}
```

---

#### `chat_reasoning` / `chat_reasoning_delta`

Extended reasoning/thinking output from the model (if supported).

```json
{
  "type": "chat_reasoning",
  "sessionId": "sdk-session-uuid-123",
  "content": "The user wants to list files..."
}
```

---

#### `tool_start`

A tool execution has started.

```json
{
  "type": "tool_start",
  "sessionId": "sdk-session-uuid-123",
  "toolId": "tool_123456",
  "name": "file_read",
  "description": "Reading file contents...",
  "arguments": { "path": "/workspace/readme.md" }
}
```

---

#### `tool_progress`

Progress update for a running tool.

```json
{
  "type": "tool_progress",
  "sessionId": "sdk-session-uuid-123",
  "toolId": "tool_123456",
  "progress": "Reading line 45 of 100..."
}
```

---

#### `tool_complete`

A tool execution has finished.

```json
{
  "type": "tool_complete",
  "sessionId": "sdk-session-uuid-123",
  "toolId": "tool_123456",
  "result": "File contents here...",
  "success": true
}
```

---

#### `mode_changed`

The Copilot SDK session mode has changed (`interactive`, `plan`, `autopilot`).

```json
{
  "type": "mode_changed",
  "sessionId": "sdk-session-uuid-123",
  "mode": "plan"
}
```

---

#### `plan_update`

An update to the plan mode task list.

```json
{
  "type": "plan_update",
  "sessionId": "sdk-session-uuid-123",
  "operation": "create",
  "content": "Create index.html"
}
```

---

#### `chat_error`

An error occurred in the chat system.

```json
{
  "type": "chat_error",
  "sessionId": "sdk-session-uuid-123",
  "message": "Copilot SDK not installed",
  "code": "SDK_MISSING"
}
```

---

#### `chat_aborted`

The chat operation was aborted (e.g., by user request or timeout).

```json
{
  "type": "chat_aborted",
  "reason": "Operation aborted"
}
```

---

#### `chat_session_deleted`

Confirmation that a session was successfully deleted.

```json
{
  "type": "chat_session_deleted",
  "success": true,
  "clientSessionId": "client-session-id-abc"
}
```

---

#### `command_result`

Result from executing a slash command.

```json
{
  "type": "command_result",
  "command": "/clear",
  "success": true,
  "message": "Chat history cleared"
}
```

---

#### `interrupt_success`

Confirmation that an ongoing stream was interrupted.

```json
{
  "type": "interrupt_success",
  "sessionId": "sdk-session-uuid-123",
  "message": "Stream interrupted"
}
```

---

#### `session_info`

Detailed session information response.

```json
{
  "type": "session_info",
  "hasSession": true,
  "sdkSessionId": "sdk-session-uuid-123",
  "dbSessionId": "db-session-456",
  "model": "llama3.2",
  "mode": "interactive",
  "historyLength": 12
}
```

Or if no active session:

```json
{
  "type": "session_info",
  "hasSession": false
}
```

---

#### `session_resumed`

Confirmation that a session was resumed from the database.

```json
{
  "type": "session_resumed",
  "success": true,
  "sdkSessionId": "sdk-session-uuid-123",
  "sessionId": "db-session-456",
  "history": []
}
```

---

### File Browsing — Client → Server

#### `browse`

Request a directory listing via WebSocket (alternative to `GET /api/browse`). The server also updates the client's `currentPath` internally.

```json
{
  "type": "browse",
  "path": "C:\\Users\\master\\cli-web-ui"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | No | Directory to browse. Defaults to `WORKSPACE_DIR` |

---

### File Browsing — Server → Client

#### `browse_result`

Directory listing response.

```json
{
  "type": "browse_result",
  "success": true,
  "path": "C:\\Users\\master\\cli-web-ui",
  "parent": "C:\\Users\\master",
  "folders": [
    { "name": "public", "path": "...", "isDirectory": true }
  ],
  "files": [
    { "name": "server.js", "path": "...", "isDirectory": false }
  ]
}
```

**Error response:**
```json
{
  "type": "browse_result",
  "success": false,
  "error": "Path does not exist"
}
```

---

### Terminal — Client → Server

#### `start_terminal`

Start a new terminal session (or reconnect to an existing one).

```json
{
  "type": "start_terminal",
  "terminalId": "default",
  "cwd": "C:\\Users\\master\\cli-web-ui",
  "shell": "pwsh",
  "cols": 120,
  "rows": 30
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `terminalId` | string | No | Unique ID for this terminal. Defaults to `"default"` |
| `cwd` | string | No | Working directory. Defaults to client's `currentPath` or `WORKSPACE_DIR` |
| `shell` | string | No | Shell ID from `GET /api/terminals/available`. Defaults to platform default |
| `cols` | number | No | Initial columns. Default `80` |
| `rows` | number | No | Initial rows. Default `24` |

---

#### `terminal_input`

Send keystrokes or text to a running terminal.

```json
{
  "type": "terminal_input",
  "terminalId": "default",
  "data": "ls -la\r"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `terminalId` | string | No | Target terminal ID. Defaults to `"default"` |
| `data` | string | **Yes** | Raw keystrokes or text to write |

---

#### `terminal_resize`

Resize the pseudo-terminal dimensions.

```json
{
  "type": "terminal_resize",
  "terminalId": "default",
  "cols": 120,
  "rows": 30
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `terminalId` | string | No | Target terminal ID. Defaults to `"default"` |
| `cols` | number | **Yes** | New column count |
| `rows` | number | **Yes** | New row count |

---

#### `close_terminal`

Kill a specific terminal session.

```json
{
  "type": "close_terminal",
  "terminalId": "default"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `terminalId` | string | No | Terminal ID to close. Defaults to `"default"` |

---

#### `get_terminals`

List all active terminals for the current user.

```json
{
  "type": "get_terminals"
}
```

**Server response:** `existing_terminals`

---

#### `reconnect_terminal`

Re-attach the WebSocket to an existing terminal that is still alive on the server (useful after page refresh).

```json
{
  "type": "reconnect_terminal",
  "terminalId": "default"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `terminalId` | string | No | Terminal ID to reconnect. Defaults to `"default"` |

---

### Terminal — Server → Client

#### `terminal_started`

A terminal session has started or been reconnected.

```json
{
  "type": "terminal_started",
  "terminalId": "default",
  "cwd": "C:\\Users\\master\\cli-web-ui",
  "shell": "pwsh",
  "reconnected": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `terminalId` | string | Terminal ID |
| `cwd` | string | Working directory of the terminal |
| `shell` | string | Shell ID in use |
| `reconnected` | boolean | `true` if this was a reconnection to an existing process |

---

#### `terminal_output`

Real-time output from the terminal process.

```json
{
  "type": "terminal_output",
  "terminalId": "default",
  "data": "total 128\r\ndrwxr-xr-x  5 user user 4096 ..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `terminalId` | string | Source terminal ID |
| `data` | string | Raw ANSI/VT100 terminal output |

---

#### `terminal_exit`

The terminal process has exited.

```json
{
  "type": "terminal_exit",
  "terminalId": "default"
}
```

---

#### `existing_terminals`

Response to `get_terminals`. Lists active terminals for the user.

```json
{
  "type": "existing_terminals",
  "terminals": [
    { "terminalId": "default", "cwd": "C:\\Users\\master\\cli-web-ui" }
  ]
}
```

---

#### `error` (Terminal / Browse)

Generic error event for terminal or browse operations.

```json
{
  "type": "error",
  "message": "Terminal default not found or expired"
}
```

---

### System / Ping

#### `ping` (Client → Server)

Keep the WebSocket connection alive and measure latency.

```json
{
  "type": "ping",
  "timestamp": 1704067200000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `timestamp` | number | No | Client timestamp for latency calculation |

---

#### `pong` (Server → Client)

Response to a client `ping`.

```json
{
  "type": "pong",
  "timestamp": 1704067200000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Echo of the client's timestamp |

---

## Data Models

### ChatMessage

```typescript
interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: number; // Unix epoch in milliseconds
}
```

### ChatSession (Database)

```typescript
interface ChatSession {
  id: string;              // Database UUID
  user_id: number;
  session_name: string;
  model: string;
  provider: string;        // e.g. "ollama", "github"
  sdk_session_id: string;    // Copilot SDK session ID
  summary: string;
  working_directory: string;
  created_at: string;      // ISO 8601
  last_activity: string;   // ISO 8601
  is_active: number;       // 1 = active, 0 = closed
}
```

### ChatSession (API Response)

```typescript
interface ChatSessionResponse {
  serverSessionId: string;
  clientSessionId: string | null;
  name: string;
  model: string;
  provider: string;
  sdkSessionId: string;
  workingDirectory: string;
  summary: string;
  createdAt: string;
  lastActivity: string;
  isActive: boolean;
  messageCount: number;
  messages: ChatMessage[];
}
```

### BrowseEntry

```typescript
interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}
```

### TerminalShell

```typescript
interface TerminalShell {
  id: string;           // e.g. "pwsh", "bash"
  name: string;         // e.g. "PowerShell Core"
  command: string;      // Executable path or command
  args: string[];       // Default launch arguments
  icon: string;         // Emoji icon
  description: string;  // Human-readable description
  recommended: boolean;
}
```

### ActiveTerminal

```typescript
interface ActiveTerminal {
  terminalId: string;
  cwd: string;          // Current working directory
}
```

---

## Error Handling

All REST endpoints return errors in the following JSON structure:

```json
{
  "success": false,
  "message": "Human-readable error description",
  "hint": "Optional remediation suggestion",
  "error": "Original error message (dev/debug only)"
}
```

### Common HTTP Status Codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad Request — missing or invalid parameters |
| `401` | Unauthorized — missing or invalid Bearer token |
| `404` | Not Found — session or resource does not exist |
| `500` | Internal Server Error |
| `503` | Service Unavailable — Copilot SDK or Ollama not ready |

### Chat-Specific Error Stages

When a connection test fails, the `stage` field indicates where the failure occurred:

| Stage | Description |
|-------|-------------|
| `ollama_health` | Ollama responded with a non-2xx status |
| `ollama_connection` | Could not reach the Ollama server at all |
| `copilot_sdk` | Copilot SDK session creation or message send failed |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OLLAMA_HOST` | URL of the Ollama server (e.g. `http://localhost:11434`). When set, Ollama is used as the LLM provider. |
| `CHAT_ENABLED` | Set to `true` to enable the chat feature. When `false`, all chat endpoints return 503. |

---

## Usage Flow Example

### Chat
1. **Check status:** `GET /api/chat/status`
2. **List models:** `GET /api/chat/models`
3. **Test connection:** `POST /api/chat/test-connection` { model: "llama3.2" }
4. **Initialize session:** `POST /api/chat/init` { model: "llama3.2" }
5. **Connect WebSocket** and listen for `chat_stream_delta` / `chat_stream_complete`
6. **Send message:** `POST /api/chat/send` { message: "Hello!" }
7. **Receive response** via WebSocket streaming events
8. **Resume later:** `POST /api/chat/sessions/:id/resume`
9. **Delete when done:** WebSocket `chat_session_delete` or database cleanup

### File Browsing
1. **Browse directory:** `GET /api/browse?path=/workspace`
2. **Or via WebSocket:** Send `{ type: "browse", path: "/workspace" }`
3. **Receive:** `browse_result` with folders and files

### Terminal
1. **Detect shells:** `GET /api/terminals/available`
2. **Start terminal:** WebSocket `{ type: "start_terminal", shell: "pwsh", cols: 120, rows: 30 }`
3. **Receive:** `terminal_started`
4. **Interact:** WebSocket `{ type: "terminal_input", data: "ls\r" }`
5. **Receive:** `terminal_output` (real-time)
6. **Resize:** WebSocket `{ type: "terminal_resize", cols: 80, rows: 24 }`
7. **Close:** WebSocket `{ type: "close_terminal" }`
8. **Reconnect:** WebSocket `{ type: "reconnect_terminal", terminalId: "default" }`
