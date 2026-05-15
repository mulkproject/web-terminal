/**
 * Web Terminal Server
 * Simplified version - directory browser + terminal only
 * With Authentication
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { dirname, join, resolve } from 'path';
import { config } from 'dotenv';
import { readFile } from 'fs/promises';
import { readdir, stat, unlink } from 'fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import * as pty from 'node-pty';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  initDatabase,
  closeDatabase,
  authenticateUser,
  resetPassword,
  getUserById,
  generateSessionToken,
  validateSessionToken,
  deleteSessionToken,
  updateUserEmail,
  getSavedCommands,
  createSavedCommand,
  updateSavedCommand,
  deleteSavedCommand,
  createChatSession,
  getActiveChatSession,
  getChatSessionById,
  getChatSessionBySdkId,
  updateChatSessionSdkId,
  updateChatSessionPiFile,
  updateChatSessionSummary,
  getChatSessions,
  updateChatSessionActivity,
  updateChatSessionModel,
  updateChatSessionAgentEngine,
  closeChatSession,
  deleteChatSession,
  addChatMessage,
  getChatMessages,
  getRecentChatMessages,
  clearChatMessages,
  renameChatSession,
  cleanupUserChatSessions
} from './database.js';

// Image upload handling
import multer from 'multer';
import { mkdir, access } from 'fs/promises';
import { join as pathJoin, extname, basename } from 'path';

// PI Agent Adapter
import {
  createPiSession,
  restorePiSession,
  getPiSession,
  getPiSessionFile,
  sendPiPrompt,
  abortPiSession,
  endPiSession,
  listPiSessions,
  respondToPiExtensionUI
} from './pi-agent-adapter.js';

// Copilot SDK client (legacy, kept as null during pi-agent migration)
let copilotClient = null;
let CopilotClient = null;
async function initCopilotClient() { return false; }
async function initCopilotChatSession() { return { session: null, sessionId: null, sdkSessionId: null, history: [] }; }
function getCopilotFallbackModels() { return []; }

// Load environment variables
config();

// Debug: Log environment configuration
console.log('🔧 Environment Configuration:');
console.log('  PORT:', process.env.PORT || '3456 (default)');
console.log('  WORKSPACE_DIR:', process.env.WORKSPACE_DIR || process.cwd());
console.log('  OLLAMA_HOST:', process.env.OLLAMA_HOST || 'http://localhost:11434 (default)');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || 'localhost';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const CHAT_ENABLED = process.env.CHAT_ENABLED !== 'false';
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
if (!['ollama', 'nvidia', 'opencode-zen'].includes(LLM_PROVIDER)) {
  console.warn(`⚠️  Unsupported LLM provider "${LLM_PROVIDER}" — only "ollama", "nvidia", and "opencode-zen" are supported. Defaulting to "ollama".`);
}

/**
 * Build PI Agent provider configuration based on the configured LLM provider.
 * PI Agent accepts --provider, --model, --api-key CLI flags plus OPENAI_BASE_URL
 * and OPENAI_API_KEY env vars for OpenAI-compatible endpoints (NVIDIA NIM, Ollama).
 * NOTE: We do NOT set PI_OFFLINE=1 — that would suppress the actual LLM inference call.
 */
function buildPiProviderConfig(provider = null) {
  const effectiveProvider = provider || LLM_PROVIDER;
  if (effectiveProvider === 'nvidia' && process.env.NVIDIA_API_KEY) {
    return {
      provider: 'openai',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: process.env.NVIDIA_API_KEY,
      // NVIDIA NIM free-tier rejects the `tools` field → disable built-in tools
      noBuiltinTools: true
    };
  }
  if (effectiveProvider === 'opencode-zen' && process.env.OPENCODE_ZEN_API_KEY) {
    const model = process.env.OPENCODE_ZEN_MODEL || 'deepseek-v4-flash-free';
    return {
      provider: 'opencode-zen',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey: process.env.OPENCODE_ZEN_API_KEY,
      model: model,
      noBuiltinTools: false
    };
  }
  if (effectiveProvider === 'ollama' && process.env.OLLAMA_HOST) {
    const ollamaBaseUrl = process.env.OLLAMA_HOST.replace(/\/$/, '');
    const openAiCompatibleUrl = ollamaBaseUrl.endsWith('/v1') ? ollamaBaseUrl : `${ollamaBaseUrl}/v1`;
    return {
      provider: 'ollama',  // MUST be 'ollama' for modelRegistry to find Ollama models
      baseUrl: openAiCompatibleUrl,
      apiKey: 'ollama'
    };
  }
  return null;
}

/**
 * Safely convert a tool result (which may be an Error, object, or string)
 * into a displayable string for the frontend.
 */
function safeStringifyToolResult(result) {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  if (result instanceof Error) return result.message || String(result);
  if (typeof result.message === 'string') return result.message;
  if (typeof result.toString === 'function' && result.toString !== Object.prototype.toString) {
    return result.toString();
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

console.log('Configuration:');
console.log('  PORT:', PORT);
console.log('  HOST:', HOST);
console.log('  OLLAMA_HOST:', process.env.OLLAMA_HOST || 'http://localhost:11434 (default)');

// ==========================================
// TTS (Text-to-Speech) — Edge-TTS
// ==========================================

import { spawn } from 'child_process';
import crypto from 'crypto';

const TTS_ENABLED = process.env.TTS_ENABLED !== 'false';
const TTS_VOICE = process.env.TTS_VOICE || 'af_heart';
const TTS_MAX_CACHE = 200; // max cached entries
const TTS_FILE_AGE_MS = 60 * 60 * 1000; // 1 hour

let ttsProcess = null;
let ttsCallbacks = new Map(); // id -> { resolve, reject }
let ttsCache = new Map();     // textHash -> audioUrl
let ttsRequestId = 0;
let ttsBackendName = '';       // 'edge-tts' | ''

let ttsRetryCount = 0;
const TTS_MAX_RETRIES = 3;
let ttsPermanentlyDisabled = false;

function startTtsWorker() {
  if (!TTS_ENABLED || ttsPermanentlyDisabled) {
    return;
  }
  if (ttsRetryCount >= TTS_MAX_RETRIES) {
    console.error('❌ Edge-TTS worker failed after 3 retries. TTS permanently disabled.');
    ttsPermanentlyDisabled = true;
    return;
  }
  try {
    console.log('🗣️  Starting Edge-TTS worker...');
    const edgeTtsScript = join(__dirname, 'edge-tts.py');
    ttsProcess = spawn('python', [edgeTtsScript], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    ttsProcess.stdout.on('data', (buf) => {
      try {
        const lines = buf.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          const res = JSON.parse(line);
          if (res.status === 'ready') {
            console.log('🗣️  TTS worker ready');
            ttsRetryCount = 0;
            if (res.backend) {
              ttsBackendName = res.backend;
              console.log('🗣️  TTS backend:', res.backend);
            }
            continue;
          }
          if (res.voices) {
            console.log('🗣️  TTS voices list received');
            continue;
          }
          const cb = ttsCallbacks.get(res.id);
          if (cb) {
            if (res.audio && !res.audioUrl) {
              res.audioUrl = res.audio;
            }
            if (res.error) {
              console.error('🗣️  TTS worker error:', res.error);
            }
            cb.resolve(res);
            ttsCallbacks.delete(res.id);
          } else if (res.error) {
            console.error('🗣️  TTS worker error (no callback):', res.error);
          }
        }
      } catch (e) {
        console.error('TTS parse error:', e.message);
      }
    });

    ttsProcess.stderr.on('data', (buf) => {
      console.error('[edge-tts]', buf.toString().trim());
    });

    ttsProcess.on('close', (code) => {
      ttsProcess = null;
      if (code !== 0) {
        ttsRetryCount++;
        if (ttsRetryCount < TTS_MAX_RETRIES) {
          console.warn(`⚠️  Edge-TTS worker exited (${code}), retry ${ttsRetryCount}/${TTS_MAX_RETRIES} in 5s...`);
          setTimeout(startTtsWorker, 5000);
        } else {
          console.error('❌ Edge-TTS permanently disabled after max retries.');
          ttsPermanentlyDisabled = true;
        }
      }
    });

    ttsProcess.on('error', (err) => {
      console.error('Failed to spawn Edge-TTS worker:', err.message);
      ttsProcess = null;
      ttsRetryCount++;
      if (ttsRetryCount < TTS_MAX_RETRIES) {
        setTimeout(startTtsWorker, 5000);
      } else {
        console.error('❌ Edge-TTS permanently disabled after spawn failures.');
        ttsPermanentlyDisabled = true;
      }
    });
  } catch (err) {
    console.error('TTS worker spawn error:', err.message);
    ttsRetryCount++;
    if (ttsRetryCount >= TTS_MAX_RETRIES) {
      ttsPermanentlyDisabled = true;
    }
  }
}

// Serve generated audio files statically (UUIDs act as opaque unguessable tokens)
app.use('/tts', express.static(pathJoin(__dirname, 'tts')));

// ==========================================
// Terminal Detection
// ==========================================

function detectAvailableTerminals() {
  const terminals = [];
  const isWindows = os.platform() === 'win32';
  
  if (isWindows) {
    // Check for PowerShell Core (pwsh) first - preferred modern version
    try {
      const result = execSync('pwsh --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      terminals.push({
        id: 'pwsh',
        name: 'PowerShell Core',
        command: 'pwsh.exe',
        args: [],
        icon: '⚡',
        description: 'Modern cross-platform PowerShell',
        recommended: true
      });
    } catch (e) {
      // PowerShell Core not installed
    }
    
    // Check for Windows PowerShell (legacy)
    try {
      const result = execSync('powershell -Command "$PSVersionTable.PSVersion"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      terminals.push({
        id: 'powershell',
        name: 'Windows PowerShell',
        command: 'powershell.exe',
        args: [],
        icon: '🔷',
        description: 'Windows built-in PowerShell',
        recommended: false
      });
    } catch (e) {
      // Windows PowerShell not available
    }
    
    // Command Prompt (always available on Windows)
    terminals.push({
      id: 'cmd',
      name: 'Command Prompt',
      command: 'cmd.exe',
      args: ['/k', 'title Web Terminal'],
      icon: '⌨️',
      description: 'Classic Windows CMD',
      recommended: false
    });
    
    // Check for Git Bash
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.USERPROFILE || '', 'AppData\\Local\\Programs\\Git\\bin\\bash.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs\\Git\\bin\\bash.exe')
    ];
    
    for (const gitBashPath of gitBashPaths) {
      if (existsSync(gitBashPath)) {
        terminals.push({
          id: 'gitbash',
          name: 'Git Bash',
          command: gitBashPath,
          args: ['--login', '-i'],
          icon: '🔶',
          description: 'Bash from Git for Windows',
          recommended: false
        });
        break;
      }
    }
    
    // Check for WSL
    try {
      const result = execSync('wsl --list --quiet', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      if (result !== null) {
        terminals.push({
          id: 'wsl',
          name: 'WSL (Windows Subsystem for Linux)',
          command: 'wsl.exe',
          args: [],
          icon: '🐧',
          description: 'Run Linux commands on Windows',
          recommended: false
        });
      }
    } catch (e) {
      // WSL not available
    }
  } else {
    // Unix/Linux/Mac/Android systems
    const unixShells = [
      { id: 'bash', command: 'bash', args: [], icon: '🐚', description: 'Bourne Again Shell' },
      { id: 'zsh', command: 'zsh', args: [], icon: '⭐', description: 'Z Shell (modern)' },
      { id: 'fish', command: 'fish', args: [], icon: '🐟', description: 'Friendly Interactive Shell' },
      { id: 'sh', command: 'sh', args: [], icon: '⌨️', description: 'Standard Shell' }
    ];
    
    for (const shell of unixShells) {
      try {
        execSync(`which ${shell.command}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        terminals.push({
          ...shell,
          name: shell.command.charAt(0).toUpperCase() + shell.command.slice(1),
          recommended: shell.id === 'zsh' || shell.id === 'bash'
        });
      } catch (e) {
        // Shell not available
      }
    }
    
    // Android / Termux shells (when server runs on-device or in Termux)
    const androidShells = [
      { id: 'termux-bash', path: '/data/data/com.termux/files/usr/bin/bash', args: [], icon: '📱', description: 'Termux Bash' },
      { id: 'termux-zsh', path: '/data/data/com.termux/files/usr/bin/zsh', args: [], icon: '📱', description: 'Termux Zsh' },
      { id: 'android-sh', path: '/system/bin/sh', args: [], icon: '🤖', description: 'Android system shell' }
    ];
    
    for (const shell of androidShells) {
      if (existsSync(shell.path)) {
        terminals.push({
          id: shell.id,
          name: shell.description,
          command: shell.path,
          args: shell.args,
          icon: shell.icon,
          description: shell.description,
          recommended: terminals.length === 0  // Recommend if no other shells found
        });
      }
    }
  }
  
  return terminals;
}

// Cache available terminals
let availableTerminalsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute cache

function getAvailableTerminals() {
  const now = Date.now();
  if (!availableTerminalsCache || (now - cacheTimestamp) > CACHE_DURATION) {
    availableTerminalsCache = detectAvailableTerminals();
    cacheTimestamp = now;
    console.log('🖥️  Detected terminals:', availableTerminalsCache.map(t => t.name).join(', '));
  }
  return availableTerminalsCache;
}

// Initialize database
initDatabase();

// Store active terminals
const terminals = new Map(); // userId_terminalId -> { pty, cwd, terminalId, userId, ws, lastActivity }
const clients = new Map(); // ws -> { currentPath, id, userId, authenticated }

// Store active PI Agent chat sessions
const chatSessions = new Map(); // userId -> Map(clientSessionId -> { clientSessionId, serverSessionId, piSessionId, name, model, history, lastActivity })
const creationLocks = new Map(); // userId -> Set(clientSessionId) — prevents duplicate session creation
const CHAT_GRACE_PERIOD = 30 * 60 * 1000; // 30 minutes grace period for chat sessions

// Engine is always PI Agent
const DEFAULT_AGENT_ENGINE = 'pi-agent';

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    llmProvider: LLM_PROVIDER,
    ollamaHost: process.env.OLLAMA_HOST || null,
    nvidiaApiKey: !!process.env.NVIDIA_API_KEY,
    availableProviders: [
      ...(process.env.OLLAMA_HOST ? [{ id: 'ollama', name: 'Ollama' }] : []),
      ...(process.env.NVIDIA_API_KEY ? [{ id: 'nvidia', name: 'NVIDIA NIM' }] : [])
    ]
  });
});

// Public chat provider status (for launcher/UI testing)
app.get('/api/chat/provider-status', async (req, res) => {
  try {
    let providerStatus = 'unknown';
    let modelsCount = 0;
    let modelList = [];
    let connectionMessage = '';
    let copilotAuthenticated = false;
    let copilotUser = null;

    if (LLM_PROVIDER === 'ollama' && process.env.OLLAMA_HOST) {
      try {
        const ollamaUrl = process.env.OLLAMA_HOST.replace(/\/$/, '');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${ollamaUrl}/api/tags`, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          const models = data.models || [];
          providerStatus = 'connected';
          modelsCount = models.length;
          modelList = models.slice(0, 5).map(m => m.name || m.model);
          connectionMessage = `Ollama reachable (${models.length} models)`;
        } else {
          providerStatus = 'error';
          connectionMessage = `Ollama returned HTTP ${response.status}`;
        }
      } catch (err) {
        providerStatus = 'unreachable';
        connectionMessage = `Cannot reach Ollama: ${err.message}`;
      }
    } else if (LLM_PROVIDER === 'nvidia' && process.env.NVIDIA_API_KEY) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
          headers: { 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}` },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          const models = data.data || [];
          providerStatus = 'connected';
          modelsCount = models.length;
          modelList = models.slice(0, 5).map(m => m.id || m.name);
          connectionMessage = `NVIDIA NIM reachable (${models.length} models)`;
        } else {
          providerStatus = 'error';
          connectionMessage = `NVIDIA NIM returned HTTP ${response.status}`;
        }
      } catch (err) {
        providerStatus = 'unreachable';
        connectionMessage = `Cannot reach NVIDIA NIM: ${err.message}`;
        // Provide fallback model list so UI isn't empty
        modelList = getNvidiaFallbackModels().map(m => m.id || m.name);
      }
    } else {
      providerStatus = 'not_configured';
      connectionMessage = `Provider "${LLM_PROVIDER}" is not configured. Set OLLAMA_HOST for Ollama or NVIDIA_API_KEY for NVIDIA NIM.`;
    }

    res.json({
      provider: LLM_PROVIDER,
      status: providerStatus,
      modelsCount,
      models: modelList,
      message: connectionMessage,
      ollamaHost: process.env.OLLAMA_HOST || null,
      copilotAuthenticated: false,
      copilotUser: null
    });
  } catch (err) {
    console.error('Provider status error:', err);
    res.status(500).json({ provider: LLM_PROVIDER, status: 'error', message: err.message });
  }
});
// ==========================================
// Image Upload Configuration
// ==========================================

// Configure multer for image uploads
const imageStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Get working directory from request body (set by middleware)
      const workingDir = req.body?.workingDirectory || WORKSPACE_DIR;
      const imagesDir = pathJoin(workingDir, 'images');
      
      // Create images directory if it doesn't exist
      try {
        await access(imagesDir);
      } catch {
        await mkdir(imagesDir, { recursive: true });
        console.log(`📁 Created images directory: ${imagesDir}`);
      }
      
      cb(null, imagesDir);
    } catch (err) {
      console.error('Error creating images directory:', err);
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const ext = extname(file.originalname);
    const baseName = basename(file.originalname, ext);
    const safeName = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const uniqueName = `${safeName}_${timestamp}${ext}`;
    cb(null, uniqueName);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Configure multer for audio uploads (STT)
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = pathJoin(__dirname, 'temp_audio');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `voice_${Date.now()}.wav`);
  }
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Image upload endpoint
app.post('/api/upload-image', requireAuth, imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    
    const imagePath = req.file.path;
    const relativePath = imagePath.replace(WORKSPACE_DIR, '').replace(/^[/\\]/, '');
    
    console.log(`📤 Image uploaded: ${imagePath}`);
    
    res.json({
      success: true,
      imagePath: imagePath,
      relativePath: relativePath,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ error: 'Failed to upload image: ' + err.message });
  }
});

// Serve uploaded images
app.get('/api/images/*', requireAuth, (req, res) => {
  const imagePath = decodeURIComponent(req.params[0]);
  const fullPath = pathJoin(WORKSPACE_DIR, imagePath);
  
  // Security check - ensure path is within WORKSPACE_DIR
  if (!fullPath.startsWith(WORKSPACE_DIR)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  res.sendFile(fullPath, (err) => {
    if (err) {
      console.error('Error serving image:', err);
      res.status(404).json({ error: 'Image not found' });
    }
  });
});

// ==========================================
// ==========================================

/**
 * Attempt to retrieve the GitHub token from the local gh CLI.
 * This bridges the host machine's Copilot CLI auth to the SDK client.
 * @returns {{token: string|null, authenticated: boolean, user: string|null, method: string|null}}
 */




// Function to check available Ollama models
async function getAvailableOllamaModels() {
  try {
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const response = await fetch(`${ollamaHost}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      return data.models || [];
    }
  } catch (err) {
    console.error('Failed to fetch Ollama models:', err.message);
  }
  return [];
}

// Function to validate if a model is available
async function validateOllamaModel(model) {
  const availableModels = await getAvailableOllamaModels();
  const modelIds = availableModels.map(m => m.name || m.model);
  return modelIds.includes(model);
}

// NVIDIA NIM model helpers
// NOTE: Updated from NVIDIA API reference and community testing (2026-05).
// Confirmed working free-tier NVIDIA models (tested live)
const NVIDIA_FALLBACK_MODELS = [
  { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (Fast)' },
  { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
  { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' },
  { id: 'meta/llama-3.2-1b-instruct', name: 'Llama 3.2 1B' },
  { id: 'meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { id: 'meta/llama-2-70b-chat', name: 'Llama 2 70B Chat' },
  { id: 'microsoft/phi-3-mini-128k-instruct', name: 'Phi-3 Mini' },
  { id: 'microsoft/phi-3-medium-128k-instruct', name: 'Phi-3 Medium' },
  { id: 'google/gemma-2-9b-it', name: 'Gemma 2 9B' },
  { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B' },
  { id: 'google/codegemma-7b', name: 'CodeGemma 7B' },
  { id: 'mistralai/mistral-7b-instruct-v0.3', name: 'Mistral 7B' },
  { id: 'mistralai/mixtral-8x7b-instruct-v0.1', name: 'Mixtral 8x7B' },
  { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B' },
  { id: 'mistralai/mistral-large-instruct-2407', name: 'Mistral Large' },
  { id: 'nv-mistralai/mistral-nemo-12b-instruct', name: 'Mistral Nemo 12B' },
  { id: 'qwen/qwen2-7b-instruct', name: 'Qwen2 7B' },
  { id: 'qwen/qwen2.5-7b-instruct', name: 'Qwen2.5 7B' },
  { id: 'qwen/qwen2.5-14b-instruct', name: 'Qwen2.5 14B' },
  { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen2.5 72B' },
  { id: 'deepseek-ai/deepseek-coder-6.7b-instruct', name: 'DeepSeek Coder 6.7B' },
  { id: 'stepfun-ai/step-3.5-flash', name: 'StepFun 3.5 Flash (Reasoning)' },
];

const NVIDIA_MODEL_DISPLAY_NAMES = {
  'meta/llama-3.1-8b-instruct': 'Llama 3.1 8B (Fast)',
  'meta/llama-3.1-70b-instruct': 'Llama 3.1 70B',
  'meta/llama-3.1-405b-instruct': 'Llama 3.1 405B',
  'meta/llama-3.2-1b-instruct': 'Llama 3.2 1B',
  'meta/llama-3.2-3b-instruct': 'Llama 3.2 3B',
  'meta/llama-3.3-70b-instruct': 'Llama 3.3 70B',
  'meta/llama-2-70b-chat': 'Llama 2 70B Chat',
  'microsoft/phi-3-mini-128k-instruct': 'Phi-3 Mini',
  'microsoft/phi-3-medium-128k-instruct': 'Phi-3 Medium',
  'google/gemma-2-9b-it': 'Gemma 2 9B',
  'google/gemma-2-27b-it': 'Gemma 2 27B',
  'google/codegemma-7b': 'CodeGemma 7B',
  'mistralai/mistral-7b-instruct-v0.3': 'Mistral 7B',
  'mistralai/mixtral-8x7b-instruct-v0.1': 'Mixtral 8x7B',
  'mistralai/mixtral-8x22b-instruct-v0.1': 'Mixtral 8x22B',
  'mistralai/mistral-large-instruct-2407': 'Mistral Large',
  'nv-mistralai/mistral-nemo-12b-instruct': 'Mistral Nemo 12B',
  'qwen/qwen2-7b-instruct': 'Qwen2 7B',
  'qwen/qwen2.5-7b-instruct': 'Qwen2.5 7B',
  'qwen/qwen2.5-14b-instruct': 'Qwen2.5 14B',
  'qwen/qwen2.5-72b-instruct': 'Qwen2.5 72B',
  'deepseek-ai/deepseek-coder-6.7b-instruct': 'DeepSeek Coder 6.7B',
  'stepfun-ai/step-3.5-flash': 'StepFun 3.5 Flash (Reasoning)',
};

function getNvidiaModelDisplayName(modelId) {
  return NVIDIA_MODEL_DISPLAY_NAMES[modelId] || modelId;
}

function getNvidiaFallbackModels() {
  return NVIDIA_FALLBACK_MODELS;
}

// OpenCode Zen model helpers
// Free and paid models from OpenCode Zen gateway
// Docs: https://opencode.ai/docs/zen/
const OPENCODE_ZEN_FALLBACK_MODELS = [
  // Free tier models
  { id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash (Free)', type: 'opencode-zen', free: true },
  { id: 'minimax-m2.5-free', name: 'MiniMax M2.5 (Free)', type: 'opencode-zen', free: true },
  { id: 'ring-2.6-1t-free', name: 'Ring 2.6 1T (Free)', type: 'opencode-zen', free: true },
  { id: 'nemotron-3-super-free', name: 'Nemotron 3 Super (Free)', type: 'opencode-zen', free: true },
  { id: 'big-pickle', name: 'Big Pickle (Free)', type: 'opencode-zen', free: true },
  // GPT models
  { id: 'gpt-5.5', name: 'GPT 5.5', type: 'opencode-zen', free: false },
  { id: 'gpt-5.5-pro', name: 'GPT 5.5 Pro', type: 'opencode-zen', free: false },
  { id: 'gpt-5.4', name: 'GPT 5.4', type: 'opencode-zen', free: false },
  { id: 'gpt-5.4-pro', name: 'GPT 5.4 Pro', type: 'opencode-zen', free: false },
  { id: 'gpt-5.4-mini', name: 'GPT 5.4 Mini', type: 'opencode-zen', free: false },
  { id: 'gpt-5.4-nano', name: 'GPT 5.4 Nano', type: 'opencode-zen', free: false },
  { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex', type: 'opencode-zen', free: false },
  { id: 'gpt-5.3-codex-spark', name: 'GPT 5.3 Codex Spark', type: 'opencode-zen', free: false },
  { id: 'gpt-5.2', name: 'GPT 5.2', type: 'opencode-zen', free: false },
  { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex', type: 'opencode-zen', free: false },
  { id: 'gpt-5.1', name: 'GPT 5.1', type: 'opencode-zen', free: false },
  { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex', type: 'opencode-zen', free: false },
  { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max', type: 'opencode-zen', free: false },
  { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini', type: 'opencode-zen', free: false },
  { id: 'gpt-5', name: 'GPT 5', type: 'opencode-zen', free: false },
  { id: 'gpt-5-codex', name: 'GPT 5 Codex', type: 'opencode-zen', free: false },
  { id: 'gpt-5-nano', name: 'GPT 5 Nano', type: 'opencode-zen', free: false },
  // Claude models
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', type: 'opencode-zen', free: false },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', type: 'opencode-zen', free: false },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', type: 'opencode-zen', free: false },
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', type: 'opencode-zen', free: false },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', type: 'opencode-zen', free: false },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', type: 'opencode-zen', free: false },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', type: 'opencode-zen', free: false },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', type: 'opencode-zen', free: false },
  { id: 'claude-3-5-haiku', name: 'Claude Haiku 3.5', type: 'opencode-zen', free: false },
  // Gemini models
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', type: 'opencode-zen', free: false },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', type: 'opencode-zen', free: false },
  // Chinese LLMs
  { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', type: 'opencode-zen', free: false },
  { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', type: 'opencode-zen', free: false },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7', type: 'opencode-zen', free: false },
  { id: 'minimax-m2.5', name: 'MiniMax M2.5', type: 'opencode-zen', free: false },
  { id: 'glm-5.1', name: 'GLM 5.1', type: 'opencode-zen', free: false },
  { id: 'glm-5', name: 'GLM 5', type: 'opencode-zen', free: false },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', type: 'opencode-zen', free: false },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', type: 'opencode-zen', free: false },
];

function getOpenCodeZenFallbackModels() {
  return OPENCODE_ZEN_FALLBACK_MODELS;
}

// Cache for OpenCode Zen available models (refreshed every 30 min)
let _zenModelsCache = null;
let _zenModelsCacheTime = 0;
const ZEN_MODELS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function getAvailableZenModels() {
  if (_zenModelsCache && (Date.now() - _zenModelsCacheTime) < ZEN_MODELS_CACHE_TTL) {
    return _zenModelsCache;
  }
  try {
    const apiKey = process.env.OPENCODE_ZEN_API_KEY;
    if (!apiKey) return getOpenCodeZenFallbackModels();
    const response = await fetch('https://opencode.ai/zen/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (response.ok) {
      const data = await response.json();
      const allModels = data.data || data.models || [];
      _zenModelsCache = allModels.map(m => ({ 
        id: m.id || m.model || m.name, 
        name: m.name || m.id || m.model,
        type: 'opencode-zen',
        free: m.free || false
      }));
      _zenModelsCacheTime = Date.now();
      console.log(`📋 OpenCode Zen API returned ${allModels.length} models`);
      return _zenModelsCache;
    } else {
      console.warn(`⚠️ OpenCode Zen API returned ${response.status}: ${response.statusText}`);
    }
  } catch (err) {
    console.error('Failed to fetch OpenCode Zen models:', err.message);
  }
  // On error or empty API, return the static fallback list
  return getOpenCodeZenFallbackModels();
}

async function validateOpenCodeZenModel(model) {
  const availableModels = await getAvailableZenModels();
  if (availableModels.length === 0) {
    // If we can't reach Zen API, fallback to static list
    return getOpenCodeZenFallbackModels().some(m => m.id === model || m.name === model);
  }
  const modelIds = availableModels.map(m => m.id || m.name);
  return modelIds.includes(model);
}


// Cache for NVIDIA available models (refreshed every 30 min)
let _nvidiaModelsCache = null;
let _nvidiaModelsCacheTime = 0;
const NVIDIA_MODELS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function getAvailableNvidiaModels() {
  if (_nvidiaModelsCache && (Date.now() - _nvidiaModelsCacheTime) < NVIDIA_MODELS_CACHE_TTL) {
    return _nvidiaModelsCache;
  }
  try {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) return getNvidiaFallbackModels();
    const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (response.ok) {
      const data = await response.json();
      const allModels = data.data || [];
      // Expose ALL models returned by the API so users see their full catalog.
      // Error handling in chat_session_create / chat_send will reject unsupported ones.
      _nvidiaModelsCache = allModels.map(m => ({ id: m.id, name: m.id }));
      _nvidiaModelsCacheTime = Date.now();
      console.log(`📋 NVIDIA API returned ${allModels.length} models`);
      return _nvidiaModelsCache;
    } else {
      console.warn(`⚠️ NVIDIA API returned ${response.status}: ${response.statusText}`);
    }
  } catch (err) {
    console.error('Failed to fetch NVIDIA NIM models:', err.message);
  }
  // On error or empty API, return the static fallback list
  return getNvidiaFallbackModels();
}

async function validateNvidiaModel(model) {
  const availableModels = await getAvailableNvidiaModels();
  if (availableModels.length === 0) {
    // If we can't reach NVIDIA API, fallback to static list
    return getNvidiaFallbackModels().some(m => m.id === model || m.name === model);
  }
  const modelIds = availableModels.map(m => m.id || m.name);
  return modelIds.includes(model);
}

// Validate a model name for the currently configured LLM provider
// Returns true if the model is valid, false otherwise
async function validateModelForProvider(model) {
  if (!model) return false;
  if (LLM_PROVIDER === 'nvidia') {
    return await validateNvidiaModel(model);
  }
  if (LLM_PROVIDER === 'opencode-zen') {
    // For OpenCode Zen, check against known free/paid models or accept any non-empty string
    const knownModels = getOpenCodeZenFallbackModels().map(m => m.id);
    return knownModels.includes(model) || (model && model.length > 0 && !model.includes('//'));
  }
  if (LLM_PROVIDER === 'ollama') {
    // For Ollama, just check the model name looks reasonable (non-empty, no obvious invalid chars)
    return model && model.length > 0 && !model.includes('//');
  }
  // For Copilot, accept any model name
  return true;
}

/**
 * Wire PI Agent event handlers (onMessage / onError) to WebSocket messages.
 * Extracted shared helper to avoid duplication between create and reconnect paths.
 */
function wirePiSessionEvents(piSession, ws, clientSessionId, clientData, serverSessionId) {
  piSession.onMessage = (eventType, payload) => {
    if (ws.readyState !== 1) {
      console.log(`[PI] WebSocket not open (state=${ws.readyState}), dropping event ${eventType}`);
      return;
    }
    const resetSending = () => {
      const userSess = chatSessions.get(clientData.userId);
      if (userSess instanceof Map) {
        const sd = userSess.get(clientSessionId);
        if (sd) {
          sd._sending = false;
          if (sd._sendingTimeout) { clearTimeout(sd._sendingTimeout); sd._sendingTimeout = null; }
        }
      }
    };
    if (eventType === 'agent_event') {
      const event = payload;
      console.log(`[PI] agent_event type=${event.type} session=${clientSessionId}`);
      switch (event.type) {
        case 'message_start': {
          console.log(`[PI] message_start session=${clientSessionId}`);
          // Signal start of streaming (frontend can show typing indicator)
          ws.send(JSON.stringify({ type: 'chat_stream_start', sessionId: clientSessionId }));
          break;
        }
        case 'text_delta': {
          // Incremental streaming text from PI Agent
          const delta = event.delta || payload?.delta || '';
          if (delta) {
            console.log(`[PI] text_delta text=${JSON.stringify(delta.slice(0,60))}`);
            ws.send(JSON.stringify({ type: 'chat_stream_delta', sessionId: clientSessionId, delta }));
          }
          break;
        }
        case 'thinking_delta': {
          // Optional: Handle reasoning/thinking text if wanted
          const delta = event.delta || payload?.delta || '';
          if (delta) {
            console.log(`[PI] thinking_delta text=${JSON.stringify(delta.slice(0,60))}`);
            // Could send as a separate type, but for now append to stream
            ws.send(JSON.stringify({ type: 'chat_stream_delta', sessionId: clientSessionId, delta }));
          }
          break;
        }
        case 'message_update': {
          // Legacy/message content updates (for backwards compatibility)
          const msg = event.message;
          let text = '';
          if (Array.isArray(msg?.content)) text = msg.content.map(c => c.type === 'text' ? c.text : '').join('');
          else if (typeof msg?.content === 'string') text = msg.content;
          console.log(`[PI] message_update text=${JSON.stringify(text?.slice(0,60))}`);
          if (text) ws.send(JSON.stringify({ type: 'chat_stream_delta', sessionId: clientSessionId, delta: text }));
          break;
        }
        case 'message_end': {
          const msg = event.message;
          let text = '';
          if (Array.isArray(msg?.content)) text = msg.content.map(c => c.type === 'text' ? c.text : '').join('');
          else if (typeof msg?.content === 'string') text = msg.content;
          console.log(`[PI] message_end text=${JSON.stringify(text?.slice(0,60))}`);
          ws.send(JSON.stringify({ type: 'chat_stream_complete', sessionId: clientSessionId }));
          ws.send(JSON.stringify({ type: 'chat_message', sessionId: clientSessionId, role: 'assistant', content: text }));
          if (text) addChatMessage(serverSessionId, 'assistant', text);
          resetSending();
          break;
        }
        case 'tool_execution_start': {
          ws.send(JSON.stringify({ type: 'tool_start', sessionId: clientSessionId, toolId: event.toolCallId, name: event.toolName, description: `Executing ${event.toolName}...`, arguments: event.args }));
          break;
        }
        case 'tool_execution_update': {
          ws.send(JSON.stringify({ type: 'tool_progress', sessionId: clientSessionId, toolId: event.toolCallId, progress: event.partialResult }));
          break;
        }
        case 'tool_execution_end': {
          const resultStr = safeStringifyToolResult(event.result);
          ws.send(JSON.stringify({ type: 'tool_complete', sessionId: clientSessionId, toolId: event.toolCallId, result: resultStr, success: !event.isError }));
          break;
        }
        case 'extension_error': {
          const errorMsg = event.error || 'Unknown error from PI Agent';
          console.error(`[PI] extension_error session=${clientSessionId}:`, errorMsg);
          ws.send(JSON.stringify({ type: 'chat_error', sessionId: clientSessionId, message: errorMsg }));
          resetSending();
          break;
        }
      }
    } else if (eventType === 'extension_ui_request') {
      ws.send(JSON.stringify({
        type: 'permission_request',
        requestId: payload.id,
        title: payload.title || 'PI Agent Request',
        message: payload.message || JSON.stringify(payload),
        actions: payload.method === 'confirm' ? ['approve', 'reject'] : ['respond']
      }));
      pendingPermissions.set(payload.id, {
        resolve: (result) => {
          try {
            respondToPiExtensionUI(clientSessionId, payload.id, { approved: result.kind === 'approve-once' });
          } catch (e) { console.error(e.message); }
        },
        userId: clientData.userId
      });
    }
  };
  piSession.onError = (errMsg) => {
    console.log(`[PI] onError session=${clientSessionId}:`, errMsg);
    ws.send(JSON.stringify({ type: 'chat_error', sessionId: clientSessionId, message: errMsg }));
    const resetSending = () => {
      const userSess = chatSessions.get(clientData.userId);
      if (userSess instanceof Map) {
        const sd = userSess.get(clientSessionId);
        if (sd) {
          sd._sending = false;
          if (sd._sendingTimeout) { clearTimeout(sd._sendingTimeout); sd._sendingTimeout = null; }
        }
      }
    };
    resetSending();
  };
}

/**
 * Ensure a working directory exists; create it recursively if needed.
 * Prevents "Parent directory does not exist" tool errors.
 */
function ensureWorkingDirectory(dir) {
  const target = dir || WORKSPACE_DIR;
  if (!existsSync(target)) {
    try { mkdirSync(target, { recursive: true }); } catch (e) { console.warn('⚠️ Could not create working dir:', target, e.message); }
  }
  return target;
}
const pendingPermissions = new Map(); // requestId -> { resolve, reject, ws }
const pendingUserInputs = new Map(); // requestId -> { resolve, reject, ws }

// Permission handler that asks the user for approval

// User input handler for ask_user tool


// Helper to look up chat session data by server session ID
function getChatSessionData(userId, sessionId) {
  const userSessions = chatSessions.get(userId);
  if (!userSessions) return null;
  let data = userSessions.get(sessionId);
  if (data) return data;
  for (const [, entry] of userSessions) {
    if (entry.sessionId === sessionId) {
      return entry;
    }
  }
  return null;
}

// Rough token estimator (4 chars ~ 1 token for English; 2 chars ~ 1 token for CJK)
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  let chars = 0;
  for (const ch of text) {
    chars += (ch.charCodeAt(0) > 127) ? 2 : 1;
  }
  return Math.ceil(chars / 4);
}

// Set up all event handlers for the session

// Helper to broadcast to all connections for a user
function broadcastToUser(userId, message) {
  for (const [ws, clientData] of clients) {
    if (clientData.userId === userId && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }
}

function formatToolResult(result, error) {
  if (error) {
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  if (result == null) return '';
  if (typeof result === 'string') return unescapeTerminalString(result);

  // SDK tool result object shape: { content, contents: [...], detailedContent }
  if (typeof result === 'object') {
    const parts = [];

    if (result.contents && Array.isArray(result.contents)) {
      for (const item of result.contents) {
        if (item.type === 'text' && item.text) {
          parts.push(item.text);
        } else if (item.type === 'terminal' && item.text) {
          parts.push(item.text);
        } else if (item.type === 'image' && item.data) {
          parts.push(`[Image: ${item.mimeType || 'image'}]`);
        } else if (item.type === 'resource_link' && item.name) {
          parts.push(`[Resource: ${item.name}]`);
        } else if (item.type === 'resource' && item.resource) {
          const r = item.resource;
          parts.push(r.text || `[Resource: ${r.uri}]`);
        }
      }
    }

    if (parts.length === 0 && result.detailedContent) {
      parts.push(result.detailedContent);
    }
    if (parts.length === 0 && result.content) {
      parts.push(result.content);
    }

    if (parts.length > 0) {
      return parts.map(unescapeTerminalString).join('\n\n');
    }

    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  return String(result);
}

function unescapeTerminalString(str) {
  if (typeof str !== 'string') return str;
  // Some SDK tool results encode newlines/tabs as literal \n / \t
  if (str.includes('\\n') || str.includes('\\t') || str.includes('\\\\')) {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
  return str;
}

// Initialize Copilot on startup - disabled to allow launcher-controlled auth
// initCopilotClient().catch(console.error);

// ==========================================
// Authentication Middleware
// ==========================================

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  
  const token = authHeader.slice(7);
  const session = validateSessionToken(token);
  
  if (!session) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
  
  req.user = session.user;
  next();
}

function requireChatEnabled(req, res, next) {
  if (!CHAT_ENABLED) {
    return res.status(403).json({ success: false, message: 'Chat feature is disabled' });
  }
  next();
}

// Apply chat feature guard to all /api/chat routes
app.use('/api/chat', requireChatEnabled);

// Get available terminals
app.get('/api/terminals/available', requireAuth, (req, res) => {
  try {
    const terminals = getAvailableTerminals();
    res.json({
      success: true,
      terminals: terminals,
      default: terminals.find(t => t.recommended)?.id || (os.platform() === 'win32' ? 'powershell' : 'bash')
    });
  } catch (err) {
    console.error('Error detecting terminals:', err);
    res.status(500).json({ success: false, message: 'Failed to detect terminals' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }
  
  const result = authenticateUser(email, password);
  
  if (result.success) {
    const tokenData = generateSessionToken(result.user.id);
    res.json({
      success: true,
      message: 'Login successful',
      user: result.user,
      token: tokenData.token,
      expiresAt: tokenData.expiresAt
    });
  } else {
    res.status(401).json({ success: false, message: result.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    deleteSessionToken(token);
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// Validate token
app.get('/api/auth/validate', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }
  
  const token = authHeader.slice(7);
  const session = validateSessionToken(token);
  
  if (session) {
    res.json({ valid: true, user: session.user });
  } else {
    res.json({ valid: false });
  }
});

// Reset password (no old password required)
app.post('/api/auth/reset-password', requireAuth, (req, res) => {
  const { newPassword, autoGenerate } = req.body;
  const userId = req.user.id;
  
  let password = newPassword;
  
  if (autoGenerate) {
    // Generate random password
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    password = '';
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  
  if (!password || password.length < 1) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }
  
  const result = resetPassword(userId, password);
  
  if (result.success) {
    res.json({ 
      success: true, 
      message: 'Password reset successfully',
      newPassword: autoGenerate ? password : undefined
    });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
});

// Change email
app.post('/api/auth/change-email', requireAuth, (req, res) => {
  const { newEmail } = req.body;
  const userId = req.user.id;

  if (!newEmail || newEmail.length < 1) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }

  const result = updateUserEmail(userId, newEmail);

  if (result.success) {
    res.json({
      success: true,
      message: 'Email updated successfully',
      newEmail: newEmail
    });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
});

// Get current user
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  res.json({ success: true, user });
});

// ==========================================
// SAVED COMMANDS API
// ==========================================

// Get all saved commands
app.get('/api/commands', requireAuth, (req, res) => {
  const commands = getSavedCommands(req.user.id);
  res.json({ success: true, commands });
});

// Create a saved command
app.post('/api/commands', requireAuth, (req, res) => {
  const { name, command } = req.body;

  if (!name || !command) {
    return res.status(400).json({ success: false, message: 'Name and command are required' });
  }

  const result = createSavedCommand(req.user.id, name, command);

  if (result.success) {
    res.json({ success: true, id: result.id, message: 'Command saved' });
  } else {
    res.status(500).json({ success: false, message: result.message });
  }
});

// Update a saved command
app.put('/api/commands/:id', requireAuth, (req, res) => {
  const { name, command } = req.body;
  const commandId = req.params.id;

  if (!name || !command) {
    return res.status(400).json({ success: false, message: 'Name and command are required' });
  }

  const result = updateSavedCommand(commandId, req.user.id, name, command);

  if (result.success) {
    res.json({ success: true, message: 'Command updated' });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
});

// Delete a saved command
app.delete('/api/commands/:id', requireAuth, (req, res) => {
  const commandId = req.params.id;
  const result = deleteSavedCommand(commandId, req.user.id);

  if (result.success) {
    res.json({ success: true, message: 'Command deleted' });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
});

// ==========================================
// COPILOT CHAT API
// ==========================================

// Get chat status
app.get('/api/chat/status', requireAuth, async (req, res) => {
  const hasCopilot = false;
  let piAgentAvailable = false;
  try {
    const cmd = process.platform === 'win32' ? 'where pi' : 'which pi';
    execSync(cmd, { stdio: 'ignore' });
    piAgentAvailable = true;
  } catch (e) {
    piAgentAvailable = false;
  }
  const userSessions = chatSessions.get(req.user.id);
  const hasSession = userSessions instanceof Map && userSessions.size > 0;
  // Get first session for history count, or null if no sessions
  const firstSession = hasSession ? userSessions.values().next().value : null;
  
  // Get actual available models and auth status based on provider
  let modelsList = [];
  let defaultModel = null;
  let copilotAuthenticated = false;
  let copilotUser = null;
  
  if (LLM_PROVIDER === 'ollama' && process.env.OLLAMA_HOST) {
    try {
      const ollamaModels = await getAvailableOllamaModels();
      modelsList = ollamaModels.map(m => m.name || m.model);
      if (modelsList.length > 0) defaultModel = modelsList[0];
      // Ollama doesn't have GitHub auth - it's local
      copilotAuthenticated = true;
    } catch (err) {
      console.error('Failed to get Ollama models for status:', err.message);
    }
  } else if (LLM_PROVIDER === 'nvidia' && process.env.NVIDIA_API_KEY) {
    try {
      let nvidiaModels = await getAvailableNvidiaModels();
      if (nvidiaModels.length === 0) {
        nvidiaModels = getNvidiaFallbackModels();
        console.log('📋 Using NVIDIA fallback model list for status');
      }
      modelsList = nvidiaModels.map(m => {
        const id = m.id || m.name;
        return { id, name: getNvidiaModelDisplayName(id) };
      });
      if (modelsList.length > 0) defaultModel = modelsList[0].id;
      copilotAuthenticated = true; // NVIDIA uses its own API key, not GitHub auth
    } catch (err) {
      console.error('Failed to get NVIDIA models for status:', err.message);
      // Use fallback on error
      const fallback = getNvidiaFallbackModels();
      modelsList = fallback.map(m => {
        const id = m.id || m.name;
        return { id, name: getNvidiaModelDisplayName(id) };
      });
      if (modelsList.length > 0) defaultModel = modelsList[0].id;
    }
  } else if (LLM_PROVIDER === 'opencode-zen' && process.env.OPENCODE_ZEN_API_KEY) {
    try {
      let zenModels = await getAvailableZenModels();
      if (zenModels.length === 0) {
        zenModels = getOpenCodeZenFallbackModels();
        console.log('📋 Using OpenCode Zen fallback model list for status');
      }
      modelsList = zenModels.map(m => ({
        id: m.id || m.name,
        name: m.name || m.id,
        free: m.free || false
      }));
      if (modelsList.length > 0) defaultModel = modelsList[0].id;
      copilotAuthenticated = true;
    } catch (err) {
      console.error('Failed to get OpenCode Zen models for status:', err.message);
      // Use fallback on error
      const fallback = getOpenCodeZenFallbackModels();
      modelsList = fallback.map(m => ({
        id: m.id,
        name: m.name,
        free: m.free
      }));
      if (modelsList.length > 0) defaultModel = modelsList[0].id;
    }
  } else if (LLM_PROVIDER === 'nvidia' && !process.env.NVIDIA_API_KEY) {
    // NVIDIA selected but no API key configured
    console.warn('⚠️ NVIDIA provider selected but NVIDIA_API_KEY not set');
    modelsList = [];
    copilotAuthenticated = false;
  } else if (LLM_PROVIDER === 'opencode-zen' && !process.env.OPENCODE_ZEN_API_KEY) {
    // OpenCode Zen selected but no API key configured
    console.warn('⚠️ OpenCode Zen provider selected but OPENCODE_ZEN_API_KEY not set');
    modelsList = [];
    copilotAuthenticated = false;
  } else {
    // Unsupported or inactive provider
    console.warn(`⚠️  LLM provider "${LLM_PROVIDER}" is not active or unsupported.`);
    modelsList = [];
    copilotAuthenticated = false;
  }
  
  // Fallback to hardcoded default
  if (!defaultModel) {
    defaultModel = LLM_PROVIDER === 'ollama' ? 'llama3.2' :
                   LLM_PROVIDER === 'opencode-zen' ? 'deepseek-v4-flash-free' :
                   'meta/llama-3.1-8b-instruct';
  }
  
  // Debug logging
  console.log('📊 Chat status check:', {
    userId: req.user.id,
    hasCopilot,
    hasSession,
    provider: LLM_PROVIDER,
    defaultModel,
    modelsCount: modelsList.length,
    copilotAuthenticated
  });
  
  res.json({
    success: true,
    copilotAvailable: hasCopilot,
    piAgentAvailable,
    copilotAuthenticated,
    copilotUser,
    hasSession,
    messageCount: firstSession?.history?.length || 0,
    llmProvider: LLM_PROVIDER,
    availableProviders: [
      ...(process.env.OLLAMA_HOST ? [{ id: 'ollama', name: 'Ollama' }] : []),
      ...(process.env.NVIDIA_API_KEY ? [{ id: 'nvidia', name: 'NVIDIA NIM' }] : []),
      ...(process.env.OPENCODE_ZEN_API_KEY ? [{ id: 'opencode-zen', name: 'OpenCode Zen' }] : [])
    ],
    ollamaConfigured: !!process.env.OLLAMA_HOST,
    nvidiaConfigured: !!process.env.NVIDIA_API_KEY,
    zenConfigured: !!process.env.OPENCODE_ZEN_API_KEY,
    ollamaHost: process.env.OLLAMA_HOST,
    ollamaModel: LLM_PROVIDER === 'ollama' ? defaultModel : null,
    nvidiaModel: LLM_PROVIDER === 'nvidia' ? defaultModel : null,
    zenModel: LLM_PROVIDER === 'opencode-zen' ? defaultModel : null,
    availableModels: modelsList
  });
});

// Check host GitHub CLI auth status (for debugging)

// Start Copilot client (public)

// Sign out from Copilot (delete token file)

// Get available LLM models (optionally filtered by provider query param)
app.get('/api/chat/models', requireAuth, async (req, res) => {
  try {
    const requestedProvider = (req.query.provider || LLM_PROVIDER).toLowerCase();
    let models = [];

    if (requestedProvider === 'ollama' && process.env.OLLAMA_HOST) {
      const ollamaModels = await getAvailableOllamaModels();
      if (ollamaModels.length > 0) {
        models = ollamaModels.map(m => ({
          id: m.name || m.model,
          name: (m.name || m.model).charAt(0).toUpperCase() + (m.name || m.model).slice(1).replace(/[-:]/g, ' '),
          type: 'ollama',
          size: m.size
        }));
      }
    } else if (requestedProvider === 'nvidia' && process.env.NVIDIA_API_KEY) {
      let nvidiaModels = await getAvailableNvidiaModels();
      if (nvidiaModels.length === 0) {
        nvidiaModels = getNvidiaFallbackModels();
        console.log('📋 Using NVIDIA fallback model list for /api/chat/models');
      }
      if (nvidiaModels.length > 0) {
        models = nvidiaModels.map(m => ({
          id: m.id || m.name,
          name: getNvidiaModelDisplayName(m.id || m.name) || m.name || m.id,
          type: 'nvidia'
        }));
      }
    } else if (requestedProvider === 'opencode-zen' && process.env.OPENCODE_ZEN_API_KEY) {
      let zenModels = await getAvailableZenModels();
      if (zenModels.length === 0) {
        zenModels = getOpenCodeZenFallbackModels();
        console.log('📋 Using OpenCode Zen fallback model list for /api/chat/models');
      }
      if (zenModels.length > 0) {
        models = zenModels.map(m => ({
          id: m.id || m.name,
          name: m.name || m.id,
          type: 'opencode-zen',
          free: m.free || false
        }));
      }
    } else {
      console.warn(`⚠️  Provider "${requestedProvider}" is not configured or unsupported.`);
    }

    // Comprehensive fallback defaults
    let fallbackModels = [];
    if (requestedProvider === 'ollama') {
      fallbackModels = [
        { id: 'llama3.2', name: 'Llama 3.2', type: 'ollama' },
        { id: 'codellama', name: 'CodeLlama', type: 'ollama' }
      ];
    } else if (requestedProvider === 'nvidia') {
      fallbackModels = getNvidiaFallbackModels().map(m => ({
        id: m.id || m.name,
        name: getNvidiaModelDisplayName(m.id || m.name),
        type: 'nvidia'
      }));
    } else if (requestedProvider === 'opencode-zen') {
      fallbackModels = getOpenCodeZenFallbackModels().map(m => ({
        id: m.id,
        name: m.name,
        type: 'opencode-zen',
        free: m.free
      }));
    }

    // Merge SDK results with fallback, deduplicate by id
    const seen = new Set(models.map(m => m.id));
    for (const fm of fallbackModels) {
      if (!seen.has(fm.id)) {
        models.push(fm);
        seen.add(fm.id);
      }
    }

    // If still empty, use fallback as sole list
    if (models.length === 0) {
      models = fallbackModels;
    }

    res.json({
      success: true,
      models,
      llmProvider: requestedProvider,
      provider: {
        type: requestedProvider,
        url: requestedProvider === 'ollama' ? (process.env.OLLAMA_HOST || 'http://localhost:11434') :
             requestedProvider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' :
             requestedProvider === 'opencode-zen' ? 'https://opencode.ai/zen/v1' :
             'GitHub Copilot Cloud'
      }
    });
  } catch (err) {
    console.error('Error getting models:', err);
    res.status(500).json({ success: false, message: 'Failed to get models' });
  }
});

// Get chat configuration (which providers are available)
app.get('/api/chat/config', requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      llmProvider: LLM_PROVIDER,
      availableProviders: [
        ...(process.env.OLLAMA_HOST ? [{ id: 'ollama', name: 'Ollama' }] : []),
        ...(process.env.NVIDIA_API_KEY ? [{ id: 'nvidia', name: 'NVIDIA NIM' }] : []),
        ...(process.env.OPENCODE_ZEN_API_KEY ? [{ id: 'opencode-zen', name: 'OpenCode Zen' }] : [])
      ],
      ollamaConfigured: !!process.env.OLLAMA_HOST,
      nvidiaConfigured: !!process.env.NVIDIA_API_KEY,
      zenConfigured: !!process.env.OPENCODE_ZEN_API_KEY,
      defaultProvider: LLM_PROVIDER
    });
  } catch (err) {
    console.error('Error getting chat config:', err);
    res.status(500).json({ success: false, message: 'Failed to get chat config' });
  }
});

// Test Ollama health directly (before Copilot SDK)
app.get('/api/chat/ollama-health', requireAuth, async (req, res) => {
  try {
    if (!process.env.OLLAMA_HOST) {
      return res.json({
        success: false,
        reachable: false,
        message: 'OLLAMA_HOST not configured'
      });
    }

    const ollamaUrl = process.env.OLLAMA_HOST.replace(/\/$/, '');
    const healthUrl = `${ollamaUrl}/api/tags`;
    
    console.log(`🔍 Checking Ollama health at: ${healthUrl}`);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`❌ Ollama health check failed: ${response.status} - ${errorText}`);
        return res.json({
          success: false,
          reachable: true,
          message: `Ollama returned error: ${response.status}`,
          statusCode: response.status
        });
      }

      const data = await response.json();
      const models = data.models || [];
      
      console.log(`✅ Ollama is reachable. ${models.length} models available`);
      
      res.json({
        success: true,
        reachable: true,
        message: `Ollama is reachable (${models.length} models)`,
        models: models.map(m => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at
        })),
        url: ollamaUrl
      });
    } catch (fetchErr) {
      console.error(`❌ Ollama not reachable: ${fetchErr.message}`);
      res.json({
        success: false,
        reachable: false,
        message: `Cannot connect to Ollama: ${fetchErr.message}`,
        error: fetchErr.message,
        hint: 'Make sure Ollama is running and the URL is correct'
      });
    }
  } catch (err) {
    console.error('Ollama health check error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Health check failed'
    });
  }
});

// Test model connection
app.post('/api/chat/test-connection', requireAuth, async (req, res) => {
  try {
    const { model } = req.body;
    
    // First check Ollama directly if configured (only in Ollama mode)
    if (LLM_PROVIDER === 'ollama' && process.env.OLLAMA_HOST) {
      try {
        const ollamaUrl = process.env.OLLAMA_HOST.replace(/\/$/, '');
        const healthResponse = await fetch(`${ollamaUrl}/api/tags`);
        
        if (!healthResponse.ok) {
          return res.status(503).json({
            success: false,
            message: `Ollama server not responding properly (HTTP ${healthResponse.status}). Check your Ollama URL and API key.`,
            stage: 'ollama_health'
          });
        }
        
        // Check if model exists in Ollama
        const healthData = await healthResponse.json();
        const availableModels = healthData.models?.map(m => m.name) || [];
        const targetModel = model || 'llama3.2';
        
        if (!availableModels.some(m => m.includes(targetModel))) {
          console.warn(`⚠️ Model ${targetModel} not found in Ollama. Available: ${availableModels.join(', ')}`);
        }
      } catch (ollamaErr) {
        return res.status(503).json({
          success: false,
          message: `Cannot reach Ollama server: ${ollamaErr.message}. Please check if Ollama is running and the URL is correct.`,
          stage: 'ollama_connection'
        });
      }
    }
    
    // PI Agent — Copilot SDK removed. Connection verified via provider health check above.
    res.json({
      success: true,
      message: 'PI Agent connection ready',
      model: model || (LLM_PROVIDER === 'ollama' ? 'llama3.2' : 'meta/llama-3.1-8b-instruct'),
      provider: LLM_PROVIDER
    });
  } catch (err) {
    console.error('Connection test failed:', err);
    
    // Provide more helpful error messages
    let message = err.message || 'Connection test failed';
    let hint = null;
    
    if (message.includes('ECONNREFUSED')) {
      message = 'Connection refused. The Ollama server is not running or the URL is incorrect.';
      hint = 'Check that Ollama is running and the URL is correct.';
    } else if (message.includes('ETIMEDOUT')) {
      message = 'Connection timed out. The Ollama server is not responding.';
      hint = 'Check your network connection and Ollama server status.';
    } else if (message.includes('ENOTFOUND')) {
      message = 'Host not found. The Ollama URL hostname could not be resolved.';
      hint = 'Check that the Ollama URL is correct.';
    } else if (message.includes('authentication') || message.includes('401')) {
      message = 'Authentication failed. Check your Ollama API key.';
      hint = 'Verify your API key is correct.';
    }
    
    res.status(500).json({ 
      success: false, 
      message,
      hint,
      error: err.message,
      stage: 'copilot_sdk'
    });
  }
});

// Initialize chat session
app.post('/api/chat/init', requireAuth, async (req, res) => {
  try {
    if (!CopilotClient) {
      return res.status(503).json({ 
        success: false, 
        message: 'Copilot SDK not installed. Run: npm install @github/copilot-sdk'
      });
    }
    
    if (!copilotClient) {
      const initialized = await initCopilotClient();
      if (!initialized) {
        return res.status(503).json({ 
          success: false, 
          message: 'Failed to initialize Copilot client. Check configuration.'
        });
      }
    }
    
    // Close existing sessions if any
    const userSessions = chatSessions.get(req.user.id);
    if (userSessions instanceof Map) {
      for (const [sessionId, sessionData] of userSessions) {
        try {
          if (sessionData.agentEngine === 'pi-agent') {
            await endPiSession(sessionData.piSessionId || sessionId);
          } else if (sessionData.session) {
            await sessionData.session.disconnect();
          }
        } catch (e) {}
      }
      userSessions.clear();
    }
    
    const { model, workingDirectory, path: clientPath } = req.body;
    const clientWorkingDir = workingDirectory || clientPath || WORKSPACE_DIR;
    const { session, sessionId, history } = await initCopilotChatSession(req.user.id, model, null, clientWorkingDir);
    
    res.json({
      success: true,
      message: 'Chat session initialized',
      model: model || 'llama3.2',
      sessionId,
      history: history.map(h => ({
        role: h.role,
        content: h.content,
        timestamp: h.timestamp
      }))
    });
  } catch (err) {
    console.error('Chat init error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Failed to initialize chat session'
    });
  }
});

// Send message to chat
app.post('/api/chat/send', requireAuth, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    
    const userSessions = chatSessions.get(req.user.id);
    let chatData = null;
    let targetSessionId = sessionId;
    
    // If specific session ID provided, use it
    if (sessionId && userSessions instanceof Map) {
      chatData = userSessions.get(sessionId);
    }
    
    // Otherwise use first available session or auto-initialize
    if (!chatData) {
      if (userSessions instanceof Map && userSessions.size > 0) {
        const firstEntry = userSessions.entries().next().value;
        chatData = firstEntry[1];
        targetSessionId = firstEntry[0];
      }
      
      if (!chatData) {
        if (!copilotClient) {
          return res.status(503).json({ 
            success: false, 
            message: 'Chat not initialized. Call /api/chat/init first.'
          });
        }
        const result = await initCopilotChatSession(req.user.id);
        chatData = userSessions?.get(result.sessionId);
        targetSessionId = result.sessionId;
      }
    }
    
    if (!chatData) {
      return res.status(503).json({ 
        success: false, 
        message: 'Failed to initialize chat session'
      });
    }
    
    // Add user message to history
    chatData.history.push({
      role: 'user',
      content: message,
      timestamp: Date.now()
    });
    chatData.lastActivity = Date.now();

    // CRITICAL FIX: Persist user message to SQLite database
    // WebSocket chat_send handler does this, but REST endpoint never did - causing messages to disappear on reload
    addChatMessage(chatData.sessionId, 'user', message);

    // Send to agent engine
    if (chatData.agentEngine === 'pi-agent') {
      const sendPromise = sendPiPrompt(chatData.piSessionId || targetSessionId, message);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('PI Agent request timed out after 120 seconds.')), 120000);
      });
      await Promise.race([sendPromise, timeoutPromise]);
    } else {
      // Send to Copilot
      // Estimate input tokens for fallback tracking
      if (!chatData.sdkUsageReceived) {
        chatData.totalInputTokens += estimateTokens(message);
      }
      await chatData.session.send({ prompt: message });
    }
    
    res.json({ success: true, message: 'Message sent', sessionId: targetSessionId });
  } catch (err) {
    console.error('Chat send error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Failed to send message'
    });
  }
});

// Get chat history
app.get('/api/chat/history', requireAuth, (req, res) => {
  // Get from database if there's an active session
  const dbSession = getActiveChatSession(req.user.id);
  let history = [];
  
  if (dbSession) {
    history = getRecentChatMessages(dbSession.id, 100);
  }
  
  // Also check in-memory sessions
  const userSessions = chatSessions.get(req.user.id);
  const isActive = userSessions instanceof Map && userSessions.size > 0;
  
  res.json({
    success: true,
    sessionId: dbSession?.id || null,
    isActive,
    history: history.map(h => ({
      role: h.role,
      content: h.content,
      timestamp: h.timestamp
    }))
  });
});

// Clear chat history
app.post('/api/chat/clear', requireAuth, async (req, res) => {
  const userSessions = chatSessions.get(req.user.id);
  if (userSessions instanceof Map) {
    for (const [sessionId, sessionData] of userSessions) {
      try {
        if (sessionData.agentEngine === 'pi-agent') {
          await endPiSession(sessionData.piSessionId || sessionId);
        } else if (sessionData.session) {
          await sessionData.session.disconnect();
        }
      } catch (e) {}
      closeChatSession(sessionData.sessionId);
    }
    userSessions.clear();
  }
  res.json({ success: true, message: 'Chat history cleared' });
});

// Get all chat sessions for the user (multi-session support)
app.get('/api/chat/sessions', requireAuth, async (req, res) => {
  try {
    // Get limit from query params (default 50, max 50)
    const limit = Math.min(parseInt(req.query.limit) || 50, 50);
    
    // Clean up old sessions (keep only last 20 per user)
    cleanupUserChatSessions(req.user.id, 20);
    
    // Get sessions from database
    const dbSessions = getChatSessions(req.user.id, limit);
    
    // Get in-memory active sessions
    const userSessions = chatSessions.get(req.user.id);
    
    // Combine with in-memory status and get messages for each session
    const sessions = [];
    for (const dbSession of dbSessions) {
      let isActive = false;
      let clientSessionId = null;
      
      if (userSessions instanceof Map) {
        for (const [cid, sessionData] of userSessions) {
          if (sessionData.sessionId === dbSession.id) {
            isActive = true;
            clientSessionId = cid;
            break;
          }
        }
      }
      
      // Validate model for session's provider before exposing to frontend
      let displayModel = dbSession.model;
      const sessionProvider = dbSession.provider || LLM_PROVIDER;
      if (sessionProvider === 'nvidia' && !(await validateNvidiaModel(displayModel))) {
        displayModel = 'meta/llama-3.1-8b-instruct';
        try { updateChatSessionModel(dbSession.id, displayModel, sessionProvider); } catch(e) {}
      } else if (sessionProvider === 'ollama' && (!displayModel || displayModel.includes('//'))) {
        displayModel = 'llama3.2';
        try { updateChatSessionModel(dbSession.id, displayModel, sessionProvider); } catch(e) {}
      }
      
      // Get recent messages for this session
      const messages = getRecentChatMessages(dbSession.id, 50);
      
      sessions.push({
        serverSessionId: dbSession.id,
        clientSessionId: clientSessionId,
        name: dbSession.session_name,
        model: displayModel,
        provider: dbSession.provider,
        agentEngine: dbSession.agent_engine || 'copilot-sdk',
        sdkSessionId: dbSession.sdk_session_id,
        workingDirectory: dbSession.working_directory,
        summary: dbSession.summary,
        createdAt: dbSession.created_at,
        lastActivity: dbSession.last_activity,
        isActive: isActive,
        messageCount: dbSession.message_count,
        messages: messages
      });
    }
    
    res.json({ success: true, sessions });
  } catch (err) {
    console.error('Error getting chat sessions:', err);
    res.status(500).json({ success: false, message: 'Failed to get chat sessions' });
  }
});

// Get specific chat session details
app.get('/api/chat/sessions/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const dbSession = getChatSessionById(sessionId, req.user.id);
    if (!dbSession) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    const messages = getRecentChatMessages(sessionId, 100);
    
    res.json({
      success: true,
      session: {
        id: dbSession.id,
        name: dbSession.session_name,
        model: dbSession.model,
        provider: dbSession.provider,
        agentEngine: dbSession.agent_engine || 'copilot-sdk',
        sdkSessionId: dbSession.sdk_session_id,
        workingDirectory: dbSession.working_directory,
        summary: dbSession.summary,
        createdAt: dbSession.created_at,
        lastActivity: dbSession.last_activity,
        isActive: dbSession.is_active === 1,
        messages: messages
      }
    });
  } catch (err) {
    console.error('Error getting chat session:', err);
    res.status(500).json({ success: false, message: 'Failed to get chat session' });
  }
});

// Resume a specific chat session
app.post('/api/chat/sessions/:sessionId/resume', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { model } = req.body;
    
    const dbSession = getChatSessionById(sessionId, req.user.id);
    if (!dbSession) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    // PI Agent resume — Copilot SDK removed
    
    // Close existing active sessions
    const existing = chatSessions.get(req.user.id);
    if (existing instanceof Map) {
      for (const [sessionId, sessionData] of existing) {
        try {
          if (sessionData.agentEngine === 'pi-agent') {
            await endPiSession(sessionData.piSessionId || sessionId);
          } else if (sessionData.session) {
            await sessionData.session.disconnect();
          }
        } catch (e) {}
      }
    }
    
    // Resume the session (use SDK session ID if available)
    const useModel = model || dbSession.model || (LLM_PROVIDER === 'ollama' ? 'llama3.2' : 'meta/llama-3.1-8b-instruct');
    const sdkSessionId = dbSession.sdk_session_id;
    
    console.log(`📂 Resuming session ${sessionId} with SDK ID: ${sdkSessionId}`);
    
    const result = {
      sessionId: dbSession.id,
      sdkSessionId: dbSession.sdk_session_id,
      history: getRecentChatMessages(dbSession.id, 50).map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }))
    };
    
    res.json({
      success: true,
      message: 'Session resumed',
      sessionId: result.sessionId,
      sdkSessionId: result.sdkSessionId,
      history: result.history.map(h => ({
        role: h.role,
        content: h.content,
        timestamp: h.timestamp
      }))
    });
  } catch (err) {
    console.error('Error resuming chat session:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Failed to resume chat session'
    });
  }
});

// Get available SDK sessions (from Copilot SDK)
app.get('/api/chat/sdk-sessions', requireAuth, async (req, res) => {
  try {
    if (!copilotClient) {
      return res.json({ success: true, sessions: [] });
    }
    
    const sdkSessions = await copilotClient.listSessions();
    
    res.json({
      success: true,
      sessions: sdkSessions.map(s => ({
        id: s.sessionId,
        startTime: s.startTime,
        modifiedTime: s.modifiedTime,
        summary: s.summary,
        context: s.context
      }))
    });
  } catch (err) {
    console.error('Error listing SDK sessions:', err);
    res.json({ success: true, sessions: [] });
  }
});

// Get server status (protected)
app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    status: 'running',
    workspace: WORKSPACE_DIR,
    terminals: terminals.size,
    chatEnabled: CHAT_ENABLED,
    user: req.user
  });
});

// ==========================================
// TTS API Endpoints
// ==========================================

// Generate TTS audio (protected)
// ── TTS text sanitizer: strip markdown so Edge-TTS doesn't read stars, dashes, etc. ──
function cleanTtsText(raw) {
  if (!raw) return '';
  let t = raw;

  // Preserve file paths before stripping markdown — extract them and replace with placeholders
  const paths = [];
  const pathRegex = /(?:[A-Za-z]:[\\/][^\s<>"|*?]+|\/(?:[^\s<>"|*?]+\/)*[^\s<>"|*?]+|\.\.?\/(?:[^\s<>"|*?]+\/)*[^\s<>"|*?]+)/g;
  t = t.replace(pathRegex, (match) => {
    // Only keep plausible paths (contain a slash or backslash, and at least one dot or word char after)
    if (match.length < 3 || (!match.includes('/') && !match.includes('\\'))) return match;
    paths.push(match);
    return `__TTSPATH${paths.length - 1}__`;
  });

  // Remove HTML tags
  t = t.replace(/<[^\u003e]+>/g, ' ');
  // Remove markdown links — keep the visible text
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  // Remove bold / italic markers
  t = t.replace(/\*{2,3}/g, ' ');
  t = t.replace(/_{2,3}/g, ' ');
  t = t.replace(/(?<!\w)[*_](?!\w)/g, ' ');
  // Remove inline code backticks and fenced code blocks
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`([^`]+)`/g, '$1');
  // Remove markdown headers
  t = t.replace(/^#{1,6}\s+/gm, ' ');
  // Remove blockquotes and common list bullets at line start
  t = t.replace(/^[\s]*[\>\-\*\+]\s+/gm, ' ');
  // Remove horizontal rules
  t = t.replace(/^[\s]*(?:-{3,}|\*{3,}|_{3,})[\s]*$/gm, ' ');
  // Collapse multiple spaces / newlines
  t = t.replace(/\s+/g, ' ').trim();

  // Restore preserved paths
  paths.forEach((p, i) => {
    t = t.replace(`__TTSPATH${i}__`, p);
  });

  return t;
}

app.post('/api/tts', requireAuth, async (req, res) => {
  try {
    const { text, voice = TTS_VOICE, speed = 1.0 } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    if (!TTS_ENABLED) {
      return res.status(503).json({ success: false, error: 'TTS is disabled on this server' });
    }

    if (!ttsProcess) {
      return res.status(503).json({ success: false, error: 'TTS engine is not running' });
    }

    // Wait for backend to be initialized
    if (!ttsBackendName) {
      return res.status(503).json({ success: false, error: 'TTS worker is starting, please wait a moment' });
    }

    // Strip markdown / special chars so TTS doesn't read them aloud
    const cleanText = cleanTtsText(text);

    // Check cache (hash uses cleaned text so identical markdown yields same audio)
    const hash = crypto.createHash('md5').update(voice + '|' + speed + '|' + cleanText).digest('hex');
    if (ttsCache.has(hash)) {
      return res.json({ success: true, audioUrl: ttsCache.get(hash), cached: true });
    }

    // Send job to Python worker
    const id = String(++ttsRequestId);
    const outputPath = join(__dirname, 'tts', `${id}.mp3`);
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ttsCallbacks.delete(id);
        reject(new Error('TTS generation timed out (60s)'));
      }, 60000);
      ttsCallbacks.set(id, { resolve: (val) => { clearTimeout(timeout); resolve(val); }, reject });
      try {
        ttsProcess.stdin.write(JSON.stringify({ id, text: cleanText, voice, speed, output: outputPath }) + '\n');
      } catch (err) {
        ttsCallbacks.delete(id);
        clearTimeout(timeout);
        reject(new Error('TTS worker stdin write failed: ' + err.message));
      }
    });

    const result = await promise;
    if (result.success) {
      // Convert local file path to a servable URL path
      let audioUrl = result.audioUrl || result.audio;
      if (audioUrl && !audioUrl.startsWith('http')) {
        const filename = basename(audioUrl);
        audioUrl = `/tts/${filename}`;
      }
      if (ttsCache.size >= TTS_MAX_CACHE) {
        const first = ttsCache.keys().next().value;
        ttsCache.delete(first);
      }
      ttsCache.set(hash, audioUrl);
      const duration = result.duration || (cleanText.length / 13);
      res.json({ success: true, audioUrl, duration, sampleRate: result.sampleRate });
    } else {
      console.error('TTS generation failed:', result.error);
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List available Edge-TTS voices (protected)
app.get('/api/tts/voices', requireAuth, (req, res) => {
  const voices = [
    // American female
    { id: 'af_heart',  name: 'American English – Heart',  lang: 'en', gender: 'female' },
    { id: 'af_alloy',  name: 'American English – Alloy',  lang: 'en', gender: 'female' },
    { id: 'af_aoede',  name: 'American English – Aoede',  lang: 'en', gender: 'female' },
    { id: 'af_bella',  name: 'American English – Bella',  lang: 'en', gender: 'female' },
    { id: 'af_jessica',name: 'American English – Jessica',lang: 'en', gender: 'female' },
    { id: 'af_kore',   name: 'American English – Kore',   lang: 'en', gender: 'female' },
    { id: 'af_nicole', name: 'American English – Nicole', lang: 'en', gender: 'female' },
    { id: 'af_nova',   name: 'American English – Nova',   lang: 'en', gender: 'female' },
    { id: 'af_river',  name: 'American English – River',  lang: 'en', gender: 'female' },
    { id: 'af_sarah',  name: 'American English – Sarah',  lang: 'en', gender: 'female' },
    { id: 'af_sky',    name: 'American English – Sky',    lang: 'en', gender: 'female' },
    // American male
    { id: 'am_adam',   name: 'American English – Adam',   lang: 'en', gender: 'male' },
    { id: 'am_echo',   name: 'American English – Echo',   lang: 'en', gender: 'male' },
    { id: 'am_eric',   name: 'American English – Eric',   lang: 'en', gender: 'male' },
    { id: 'am_fenrir', name: 'American English – Fenrir', lang: 'en', gender: 'male' },
    { id: 'am_liam',   name: 'American English – Liam',   lang: 'en', gender: 'male' },
    { id: 'am_michael',name: 'American English – Michael',lang: 'en', gender: 'male' },
    { id: 'am_onyx',   name: 'American English – Onyx',   lang: 'en', gender: 'male' },
    { id: 'am_puck',   name: 'American English – Puck',   lang: 'en', gender: 'male' },
    { id: 'am_santa',  name: 'American English – Santa',  lang: 'en', gender: 'male' },
    // British female
    { id: 'bf_alice',  name: 'British English – Alice',   lang: 'en', gender: 'female' },
    { id: 'bf_emma',   name: 'British English – Emma',    lang: 'en', gender: 'female' },
    { id: 'bf_isabella',name:'British English – Isabella',lang: 'en', gender: 'female' },
    { id: 'bf_lily',   name: 'British English – Lily',    lang: 'en', gender: 'female' },
    // British male
    { id: 'bm_daniel', name: 'British English – Daniel',  lang: 'en', gender: 'male' },
    { id: 'bm_fable',  name: 'British English – Fable',   lang: 'en', gender: 'male' },
    { id: 'bm_george', name: 'British English – George',  lang: 'en', gender: 'male' },
    { id: 'bm_lewis',  name: 'British English – Lewis',   lang: 'en', gender: 'male' },
  ];
  res.json({ success: true, voices });
});

// TTS health/status (protected)
app.get('/api/tts/status', requireAuth, (req, res) => {
  res.json({
    success: true,
    enabled: TTS_ENABLED,
    workerAlive: !!ttsProcess && ttsProcess.exitCode === null,
    cacheSize: ttsCache.size
  });
});

// ==========================================
// TTS Admin Control (no auth — for launcher management)
// ==========================================

app.post('/api/tts/admin/start', (req, res) => {
  if (!TTS_ENABLED) {
    return res.status(503).json({ success: false, error: 'TTS is disabled via TTS_ENABLED env var' });
  }
  if (ttsProcess && ttsProcess.exitCode === null) {
    return res.json({ success: true, message: 'TTS worker already running' });
  }
  if (ttsPermanentlyDisabled) {
    // Allow retry by resetting permanent disable when explicitly requested
    ttsPermanentlyDisabled = false;
    ttsRetryCount = 0;
    console.log('🔄 TTS permanent disable reset by admin start request');
  }
  startTtsWorker();
  res.json({ success: true, message: 'TTS worker start requested' });
});

app.post('/api/tts/admin/stop', (req, res) => {
  if (ttsProcess && ttsProcess.exitCode === null) {
    ttsProcess.kill();
    ttsProcess = null;
    ttsRetryCount = 0;
    console.log('🛑 TTS worker stopped by admin request');
    return res.json({ success: true, message: 'TTS worker stopped' });
  }
  res.json({ success: true, message: 'TTS worker was not running' });
});

app.get('/api/tts/admin/status', (req, res) => {
  res.json({
    success: true,
    envEnabled: TTS_ENABLED,
    workerAlive: !!ttsProcess && ttsProcess.exitCode === null,
    permanentlyDisabled: ttsPermanentlyDisabled,
    retryCount: ttsRetryCount,
    cacheSize: ttsCache.size,
    backend: ttsBackendName
  });
});

// ==========================================
// STT (Speech-to-Text) API
// ==========================================

import { createReadStream, unlinkSync } from 'fs';

app.post('/api/stt', requireAuth, audioUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No audio file uploaded' });

    console.log(`🎙️ Received audio for STT: ${req.file.path} (${req.file.size} bytes)`);

    // --- INTEGRATION POINT: Choose your STT engine ---

    // OPTION A: OpenAI Whisper (requires openai package + key)
    if (process.env.OPENAI_API_KEY) {
      /*
      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(req.file.path),
        model: "whisper-1",
      });
      unlinkSync(req.file.path);
      return res.json({ success: true, text: transcription.text });
      */
    }

    // OPTION B: Mock for testing
    // In a real scenario, you'd spawn a python script or call a local whisper API
    setTimeout(() => {
      try { unlinkSync(req.file.path); } catch(e) {}
    }, 5000);

    // Fallback/Mock
    res.json({
      success: true,
      text: "This is a simulated transcription. Set OPENAI_API_KEY or integrate a local STT engine to see real results."
    });

  } catch (err) {
    console.error('STT error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update chat session summary
app.put('/api/chat/sessions/:sessionId/summary', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { summary } = req.body;
    
    if (!summary) {
      return res.status(400).json({ success: false, message: 'Summary is required' });
    }
    
    const dbSession = getChatSessionById(sessionId, req.user.id);
    if (!dbSession) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    updateChatSessionSummary(sessionId, summary);
    
    res.json({ success: true, message: 'Summary updated' });
  } catch (err) {
    console.error('Error updating summary:', err);
    res.status(500).json({ success: false, message: 'Failed to update summary' });
  }
});

// Delete chat session
app.delete('/api/chat/sessions/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Check if session exists
    const dbSession = getChatSessionById(sessionId, req.user.id);
    if (!dbSession) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Close any active SDK session
    const userSessions = chatSessions.get(req.user.id);
    if (userSessions instanceof Map) {
      const sessionData = userSessions.get(sessionId);
      if (sessionData?.session) {
        try {
          await sessionData.session.disconnect();
        } catch (e) {
          console.log('Error disconnecting SDK session:', e.message);
        }
        userSessions.delete(sessionId);
      }
      // Also check if stored by serverSessionId
      for (const [key, entry] of userSessions) {
        if (entry.sessionId === sessionId && key !== sessionId) {
          userSessions.delete(key);
        }
      }
    }

    // Delete from database
    const result = deleteChatSession(sessionId, req.user.id);
    if (result.success) {
      res.json({ success: true, message: 'Session deleted' });
    } else {
      res.status(500).json({ success: false, message: result.error || 'Failed to delete session' });
    }
  } catch (err) {
    console.error('Error deleting session:', err);
    res.status(500).json({ success: false, message: 'Failed to delete session' });
  }
});

// Browse folders (protected)
app.get('/api/browse', requireAuth, async (req, res) => {
  try {
    const requestedPath = req.query.path || WORKSPACE_DIR;
    const resolvedPath = resolve(requestedPath);
    
    if (!existsSync(resolvedPath)) {
      return res.json({ success: false, error: 'Path does not exist', path: requestedPath });
    }
    
    const stats = await stat(resolvedPath);
    if (!stats.isDirectory()) {
      return res.json({ success: false, error: 'Path is not a directory', path: requestedPath });
    }
    
    const entries = await readdir(resolvedPath, { withFileTypes: true });
    
    const folders = [];
    const files = [];
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      try {
        const entryPath = join(resolvedPath, entry.name);
        
        if (entry.isDirectory()) {
          folders.push({
            name: entry.name,
            path: entryPath,
            isDirectory: true
          });
        } else {
          files.push({
            name: entry.name,
            path: entryPath,
            isDirectory: false
          });
        }
      } catch (err) {
        // Skip entries we can't access
      }
    }
    
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    
    const parentDir = dirname(resolvedPath);
    
    res.json({
      success: true,
      path: resolvedPath,
      parent: parentDir !== resolvedPath ? parentDir : null,
      folders,
      files,
      isWorkspaceRoot: resolvedPath === resolve(WORKSPACE_DIR)
    });
  } catch (err) {
    console.error('Browse error:', err);
    res.json({ success: false, error: err.message });
  }
});

// Open folder in terminal (protected)
app.post('/api/terminal/open', requireAuth, async (req, res) => {
  const { path } = req.body;
  if (!path) {
    return res.status(400).json({ success: false, error: 'Path required' });
  }
  
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    return res.status(404).json({ success: false, error: 'Path does not exist' });
  }
  
  res.json({ success: true, path: resolvedPath });
});

// ==========================================
// WebSocket Handling
// ==========================================

wss.on('connection', (ws) => {
  console.log('Client connected');
  const clientId = Date.now().toString(36);
  clients.set(ws, { id: clientId, currentPath: WORKSPACE_DIR, authenticated: false, userId: null });
  
  ws.send(JSON.stringify({ 
    type: 'connected', 
    workspace: WORKSPACE_DIR,
    requiresAuth: true
  }));
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      const clientData = clients.get(ws);
      
      // Debug: Log all incoming messages (except ping)
      if (message.type !== 'ping') {
        console.log(`📥 WebSocket message received: ${message.type}`, { 
          authenticated: clientData?.authenticated,
          userId: clientData?.userId,
          hasSessionId: !!message.sessionId 
        });
      }
      
      // Guard chat-related messages when feature is disabled
      if (!CHAT_ENABLED && message.type.startsWith('chat_')) {
        ws.send(JSON.stringify({ type: 'chat_error', message: 'Chat feature is disabled' }));
        return;
      }
      
      switch (message.type) {
        case 'auth':
          // Handle login
          const authResult = authenticateUser(message.email, message.password);
          
          if (authResult.success) {
            const tokenData = generateSessionToken(authResult.user.id);
            
            // Update client data
            clientData.authenticated = true;
            clientData.userId = authResult.user.id;
            
            ws.send(JSON.stringify({
              type: 'auth_success',
              user: authResult.user,
              token: tokenData.token,
              expiresAt: tokenData.expiresAt
            }));
            
            console.log(`User authenticated: ${authResult.user.email}`);
          } else {
            ws.send(JSON.stringify({
              type: 'auth_failed',
              message: authResult.message
            }));
          }
          break;
          
        case 'auth_token':
          // Handle token validation
          const tokenResult = validateSessionToken(message.token);
          
          if (tokenResult) {
            clientData.authenticated = true;
            clientData.userId = tokenResult.user.id;
            
            ws.send(JSON.stringify({
              type: 'auth_success',
              user: tokenResult.user,
              token: message.token
            }));
            
            console.log(`User authenticated via token: ${tokenResult.user.email}`);
          } else {
            ws.send(JSON.stringify({
              type: 'auth_failed',
              message: 'Invalid or expired token'
            }));
          }
          break;
          
        case 'logout':
          // Handle logout
          if (message.token) {
            deleteSessionToken(message.token);
          }
          clientData.authenticated = false;
          clientData.userId = null;
          
          // Kill all terminals for this client
          for (const [key, t] of terminals) {
            if (t.ws === ws) {
              try { t.pty.kill(); } catch (e) {}
              terminals.delete(key);
            }
          }
          
          ws.send(JSON.stringify({ type: 'logged_out' }));
          console.log('User logged out');
          break;
          
        case 'reset_password':
          // Handle password reset
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          let newPassword = message.newPassword;
          
          if (message.autoGenerate) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
            newPassword = '';
            for (let i = 0; i < 16; i++) {
              newPassword += chars.charAt(Math.floor(Math.random() * chars.length));
            }
          }
          
          if (!newPassword || newPassword.length < 1) {
            ws.send(JSON.stringify({ type: 'error', message: 'Password is required' }));
            return;
          }
          
          const resetResult = resetPassword(clientData.userId, newPassword);
          
          if (resetResult.success) {
            ws.send(JSON.stringify({
              type: 'password_reset',
              message: 'Password reset successfully',
              newPassword: message.autoGenerate ? newPassword : undefined
            }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: resetResult.message }));
          }
          break;
          
        case 'start_terminal':
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          // Start a new terminal session
          const cwd = message.cwd || clientData?.currentPath || WORKSPACE_DIR;
          const terminalId = message.terminalId || 'default';
          const terminalKey = `${clientData.userId}_${terminalId}`;
          
          // Get shell configuration - use selected shell or default
          let shellConfig;
          const selectedShellId = message.shell || (os.platform() === 'win32' ? 'powershell' : 'bash');
          const availableTerminals = getAvailableTerminals();
          shellConfig = availableTerminals.find(t => t.id === selectedShellId);
          
          // Fallback to default if selected shell not found
          if (!shellConfig) {
            shellConfig = availableTerminals.find(t => t.recommended) || availableTerminals[0] || {
              id: os.platform() === 'win32' ? 'powershell' : 'bash',
              command: os.platform() === 'win32' ? 'powershell.exe' : 'bash',
              args: []
            };
          }
          
          // Check if terminal already exists (from previous session)
          const existingTerm = terminals.get(terminalKey);
          if (existingTerm?.pty) {
            // Reconnect to existing terminal
            existingTerm.ws = ws;
            existingTerm.lastActivity = Date.now();
            delete existingTerm.disconnectedAt;
            
            ws.send(JSON.stringify({ 
              type: 'terminal_started',
              terminalId,
              cwd: existingTerm.cwd,
              reconnected: true
            }));
            
            console.log(`Terminal ${terminalId} reconnected for user ${clientData.userId}`);
            break;
          }
          
            try {
            const isWindows = os.platform() === 'win32';
            const ptyOptions = {
              name: 'xterm-color',
              cols: message.cols || 80,
              rows: message.rows || 24,
              cwd: cwd,
              env: process.env
            };
            
            // Only use ConPTY on Windows 10+; on Linux/Mac/Android it causes EACCES/ENOENT
            if (isWindows) {
              ptyOptions.useConpty = true;
            }
            
            let ptyProcess;
            try {
              ptyProcess = pty.spawn(shellConfig.command, shellConfig.args || [], ptyOptions);
            } catch (spawnErr) {
              // If the primary shell fails (e.g., EACCES on /bin/bash), try fallback shells
              console.warn(`Primary shell ${shellConfig.command} failed: ${spawnErr.message}. Trying fallbacks...`);
              const fallbackShells = isWindows 
                ? [{ command: 'cmd.exe', args: ['/k', 'title Web Terminal'] }]
                : [
                    { command: 'sh', args: [] },
                    { command: '/bin/sh', args: [] },
                    { command: '/system/bin/sh', args: [] },
                    { command: '/data/data/com.termux/files/usr/bin/bash', args: [] },
                  ];
              
              let fallbackSuccess = false;
              for (const fallback of fallbackShells) {
                try {
                  ptyProcess = pty.spawn(fallback.command, fallback.args, { ...ptyOptions, cwd });
                  shellConfig = { ...shellConfig, command: fallback.command, args: fallback.args, id: 'fallback', name: 'Fallback Shell' };
                  console.log(`Fallback shell ${fallback.command} spawned successfully`);
                  fallbackSuccess = true;
                  break;
                } catch (e) {
                  console.warn(`Fallback shell ${fallback.command} also failed: ${e.message}`);
                }
              }
              
              if (!fallbackSuccess) {
                throw new Error(`All shell attempts failed. Original error: ${spawnErr.message}`);
              }
            }
            
            terminals.set(terminalKey, { 
              pty: ptyProcess, 
              cwd, 
              terminalId, 
              userId: clientData.userId,
              ws,
              lastActivity: Date.now(),
              shell: shellConfig.id
            });
            
            // Send terminal output to client
            ptyProcess.onData((data) => {
              const term = terminals.get(terminalKey);
              if (term?.ws?.readyState === 1) {
                term.ws.send(JSON.stringify({ 
                  type: 'terminal_output',
                  terminalId,
                  data: data 
                }));
              }
            });
            
            ptyProcess.onExit(() => {
              const term = terminals.get(terminalKey);
              if (term?.ws?.readyState === 1) {
                term.ws.send(JSON.stringify({ type: 'terminal_exit', terminalId }));
              }
              terminals.delete(terminalKey);
            });
            
            ws.send(JSON.stringify({ 
              type: 'terminal_started',
              terminalId,
              cwd: cwd,
              shell: shellConfig.id
            }));
            
            console.log(`Terminal ${terminalId} started with ${shellConfig.name} in: ${cwd}`);
          } catch (err) {
            console.error('Terminal start error:', err);
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Failed to start terminal: ' + err.message 
            }));
          }
          break;
          
        case 'terminal_input':
          if (!clientData.authenticated) {
            return;
          }
          
          // Send input to specific terminal
          const inputTerminalId = message.terminalId || 'default';
          const inputTerminalKey = `${clientData.userId}_${inputTerminalId}`;
          const inputTerm = terminals.get(inputTerminalKey);
          if (inputTerm?.pty && message.data) {
            inputTerm.pty.write(message.data);
            inputTerm.lastActivity = Date.now();
          }
          break;
          
        case 'terminal_resize':
          // Resize specific terminal
          const resizeTerminalId = message.terminalId || 'default';
          const resizeTerminalKey = `${clientData.userId}_${resizeTerminalId}`;
          const resizeTerm = terminals.get(resizeTerminalKey);
          if (resizeTerm?.pty && message.cols && message.rows) {
            resizeTerm.pty.resize(message.cols, message.rows);
            resizeTerm.lastActivity = Date.now();
          }
          break;
          
        case 'close_terminal':
          // Close specific terminal
          const closeTerminalId = message.terminalId || 'default';
          const closeTerminalKey = `${clientData.userId}_${closeTerminalId}`;
          const closeTerm = terminals.get(closeTerminalKey);
          if (closeTerm?.pty) {
            try {
              closeTerm.pty.kill();
            } catch (e) {}
            terminals.delete(closeTerminalKey);
          }
          console.log(`Terminal ${closeTerminalId} closed by client`);
          break;
          
        case 'get_terminals':
          // Get all active terminals for this user
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          const userTerminals = [];
          for (const [key, t] of terminals) {
            if (t.userId === clientData.userId) {
              userTerminals.push({
                terminalId: t.terminalId,
                cwd: t.cwd
              });
            }
          }
          
          ws.send(JSON.stringify({
            type: 'existing_terminals',
            terminals: userTerminals
          }));
          break;
          
        case 'reconnect_terminal':
          // Reconnect to an existing terminal
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          const reconnectTerminalId = message.terminalId || 'default';
          const reconnectTerminalKey = `${clientData.userId}_${reconnectTerminalId}`;
          const reconnectTerm = terminals.get(reconnectTerminalKey);
          
          if (reconnectTerm?.pty) {
            // Update ws reference to new connection
            reconnectTerm.ws = ws;
            reconnectTerm.lastActivity = Date.now();
            delete reconnectTerm.disconnectedAt;
            
            ws.send(JSON.stringify({
              type: 'terminal_started',
              terminalId: reconnectTerminalId,
              cwd: reconnectTerm.cwd,
              reconnected: true
            }));
            
            console.log(`Terminal ${reconnectTerminalId} reconnected for user ${clientData.userId}`);
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Terminal ${reconnectTerminalId} not found or expired`
            }));
          }
          break;
          
        case 'browse':
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          // Client requesting directory browse
          const defaultBrowsePath = WORKSPACE_DIR;
          const browsePath = message.path || defaultBrowsePath;
          try {
            const resolvedPath = resolve(browsePath);
            
            if (!existsSync(resolvedPath)) {
              ws.send(JSON.stringify({ 
                type: 'browse_result', 
                success: false, 
                error: 'Path does not exist' 
              }));
              return;
            }
            
            const entries = await readdir(resolvedPath, { withFileTypes: true });
            const folders = [];
            const files = [];
            
            for (const entry of entries) {
              if (entry.name.startsWith('.')) continue;
              
              if (entry.isDirectory()) {
                folders.push({
                  name: entry.name,
                  path: join(resolvedPath, entry.name),
                  isDirectory: true
                });
              } else {
                files.push({
                  name: entry.name,
                  path: join(resolvedPath, entry.name),
                  isDirectory: false
                });
              }
            }
            
            folders.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b) => a.name.localeCompare(b.name));
            
            const parentDir = dirname(resolvedPath);
            
            // Update client current path
            clientData.currentPath = resolvedPath;
            
            ws.send(JSON.stringify({
              type: 'browse_result',
              success: true,
              path: resolvedPath,
              parent: parentDir !== resolvedPath ? parentDir : null,
              folders,
              files
            }));
          } catch (err) {
            ws.send(JSON.stringify({ 
              type: 'browse_result', 
              success: false, 
              error: err.message 
            }));
          }
          break;
          
        case 'open_in_terminal':
          // Deprecated: use start_terminal with terminalId instead
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'open_in_terminal is deprecated. Please refresh the page.' 
          }));
          break;
          
        case 'ping':
          // Keepalive ping from client
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
          
        case 'chat_session_create':
          // Create a new chat session (multi-session support)
          console.log(`📥 Received chat_session_create request:`, { sessionId: message.sessionId, name: message.name, model: message.model });
          
          if (!clientData.authenticated) {
            console.log('❌ chat_session_create failed: Not authenticated');
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          const agentEngine = message.agentEngine || DEFAULT_AGENT_ENGINE;
          
          if (agentEngine === 'copilot-sdk' && !CopilotClient) {
            console.log('❌ chat_session_create failed: Copilot SDK not installed');
            ws.send(JSON.stringify({
              type: 'chat_error',
              message: 'Copilot SDK not installed'
            }));
            return;
          }
          
          if (agentEngine === 'pi-agent') {
            console.log('🔧 Using PI Agent engine for new session');
          }
          
          (async () => {
            const clientSessionId = message.sessionId || `session_${Date.now()}`;
            const sessionName = message.name || 'New Chat';
            let model = message.model;
            let userLocks;
            try {
              if (agentEngine === 'copilot-sdk') {
                if (!copilotClient) {
                  console.log('🔄 Initializing Copilot client...');
                  await initCopilotClient();
                }
                
                if (!copilotClient) {
                  console.log('❌ chat_session_create failed: Copilot client initialization failed');
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: 'Failed to initialize Copilot client'
                  }));
                  return;
                }
              }
              
              // Prevent duplicate session creation for the same clientSessionId
              userLocks = creationLocks.get(clientData.userId);
              if (!userLocks) {
                userLocks = new Set();
                creationLocks.set(clientData.userId, userLocks);
              }
              if (userLocks.has(clientSessionId)) {
                console.log(`⛔ Duplicate chat_session_create blocked for ${clientSessionId}`);
                return;
              }
              userLocks.add(clientSessionId);
              
              // Resolve provider: prefer client choice, then fall back to global
              const sessionProvider = (message.provider || LLM_PROVIDER).toLowerCase();
              if (!['ollama', 'nvidia', 'opencode-zen'].includes(sessionProvider)) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: `Invalid provider "${sessionProvider}". Only "ollama", "nvidia", and "opencode-zen" are supported.`
                }));
                return;
              }
              if (sessionProvider === 'ollama' && !process.env.OLLAMA_HOST) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Ollama is not configured. Set OLLAMA_HOST in your environment.'
                }));
                return;
              }
              if (sessionProvider === 'nvidia' && !process.env.NVIDIA_API_KEY) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'NVIDIA NIM is not configured. Set NVIDIA_API_KEY in your environment.'
                }));
                return;
              }
              if (sessionProvider === 'opencode-zen' && !process.env.OPENCODE_ZEN_API_KEY) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'OpenCode Zen is not configured. Set OPENCODE_ZEN_API_KEY in your environment.'
                }));
                return;
              }

              // Resolve model: prefer client choice, then first available model, then hardcoded fallback
              let availableModelList = [];
              if (sessionProvider === 'ollama') {
                availableModelList = await getAvailableOllamaModels();
              } else if (sessionProvider === 'nvidia') {
                availableModelList = await getAvailableNvidiaModels();
              } else if (sessionProvider === 'opencode-zen') {
                availableModelList = await getAvailableZenModels();
                if (availableModelList.length === 0) {
                  availableModelList = getNvidiaFallbackModels();
                }
              } else if (agentEngine === 'copilot-sdk' && copilotClient) {
                try {
                  const sdkModels = await copilotClient.listModels();
                  availableModelList = sdkModels.map(m => ({ name: m.id }));
                } catch (modelErr) {
                  console.warn('⚠️ listModels() failed, using fallback model list:', modelErr.message);
                  availableModelList = getCopilotFallbackModels();
                }
              } else {
                availableModelList = getCopilotFallbackModels();
              }

              if (!model && availableModelList.length > 0) {
                model = availableModelList[0].name || availableModelList[0].id;
              }
              // Set default model based on provider
              if (!model) {
                if (sessionProvider === 'ollama') model = 'llama3.2';
                else if (sessionProvider === 'nvidia') model = 'meta/llama-3.1-8b-instruct';
                else model = 'meta/llama-3.1-8b-instruct';
              }

              console.log(`🔧 Creating session: ${sessionName} (${clientSessionId}) with provider: ${sessionProvider}, model: ${model}`);

              // Pre-check: Validate model is available for the selected provider
              if (sessionProvider === 'ollama') {
                const modelIds = availableModelList.map(m => m.name || m.model);

                if (!modelIds.includes(model)) {
                  console.error(`❌ Model "${model}" is not available in Ollama`);
                  console.error('📋 Available models:', modelIds.join(', ') || 'None found');
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: `Model "${model}" is not available in Ollama. Available models: ${modelIds.join(', ') || 'None found'}. Run "ollama pull ${model}" to download it, or select a different model.`
                  }));
                  userLocks.delete(clientSessionId);
                  return;
                }
              }

              if (sessionProvider === 'nvidia') {
                const modelIds = availableModelList.map(m => m.id || m.name);
                if (!modelIds.includes(model)) {
                  console.error(`❌ Model "${model}" is not available on NVIDIA NIM`);
                  console.error('📋 Available models:', modelIds.join(', ') || 'None found');
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: `Model "${model}" is not available on NVIDIA NIM. Available models: ${modelIds.join(', ') || 'None found'}. Please select a different model.`
                  }));
                  userLocks.delete(clientSessionId);
                  return;
                }
              }

              // Create session in database
              const dbResult = createChatSession(clientData.userId, sessionName, model, sessionProvider, null, message.workingDirectory || null);

              if (!dbResult.success) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Failed to create chat session in database'
                }));
                userLocks.delete(clientSessionId);
                return;
              }

              // Normalize model name for Ollama (add :latest if no tag specified)
              const normalizedModel = sessionProvider === 'ollama' ? (model.includes(':') ? model : `${model}:latest`) : model;

              // Get working directory from message or use default
              const workingDirectory = ensureWorkingDirectory(message.workingDirectory || WORKSPACE_DIR);

              // Create agent session based on engine selection
              let sdkSessionId = null;
              let chatSessionData;

              if (agentEngine === 'pi-agent') {
                // ===== PI Agent RPC mode =====
                const piProviderConfig = buildPiProviderConfig(sessionProvider);
                if (!piProviderConfig) {
                  console.warn('⚠️  Cannot create PI Agent session — no valid provider config. Check LLM_PROVIDER and API keys.');
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: 'PI Agent engine requires a configured Ollama or NVIDIA NIM provider. Check your environment variables.'
                  }));
                  const locks = creationLocks.get(clientData.userId);
                  if (locks) locks.delete(clientSessionId);
                  return;
                }
                try {
                  const piSession = await createPiSession(clientSessionId, sessionName, model, workingDirectory, piProviderConfig);

                  // Persist PI's native session file path to our DB for future reconnection
                  if (piSession.sessionFile) {
                    updateChatSessionPiFile(dbResult.sessionId, piSession.sessionFile);
                    console.log(`💾 PI session file persisted to DB: ${piSession.sessionFile}`);
                  }

                  // Wire PI events to WebSocket messages for this user
                  wirePiSessionEvents(piSession, ws, clientSessionId, clientData, dbResult.sessionId);

                  console.log('✅ PI Agent session created successfully');

                  chatSessionData = {
                    clientSessionId: clientSessionId,
                    sessionId: dbResult.sessionId,
                    sdkSessionId: null,
                    session: null, // PI uses adapter, not SDK session object
                    piSessionId: clientSessionId,
                    agentEngine: 'pi-agent',
                    name: sessionName,
                    model: model,
                    provider: sessionProvider,
                    workingDirectory: workingDirectory,
                    history: [],
                    lastActivity: Date.now(),
                    currentMode: 'interactive',
                    autoApprove: true,
                    pendingToolCalls: new Map(),
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    totalTokens: 0,
                    totalCacheReadTokens: 0,
                    totalCacheWriteTokens: 0,
                    totalReasoningTokens: 0,
                    sdkUsageReceived: false,
                    _sending: false,
                    _sendingTimeout: null
                  };
                } catch (piErr) {
                  console.error('❌ Failed to create PI Agent session:', piErr.message);
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: `Failed to create PI Agent session: ${piErr.message}. Is PI installed?`
                  }));
                  const locks = creationLocks.get(clientData.userId);
                  if (locks) locks.delete(clientSessionId);
                  return;
                }
              } else {
                // ===== Copilot SDK mode =====
                const sessionConfig = {
                  onPermissionRequest: createPermissionHandler(clientData.userId),
                  model: normalizedModel,
                  workingDirectory: workingDirectory || WORKSPACE_DIR,
                };
                
                // Add BYOK provider for Ollama or NVIDIA
                if (LLM_PROVIDER === 'ollama' && process.env.OLLAMA_HOST) {
                  const ollamaBaseUrl = process.env.OLLAMA_HOST.replace(/\/$/, '');
                  const openAiCompatibleUrl = ollamaBaseUrl.endsWith('/v1') ? ollamaBaseUrl : `${ollamaBaseUrl}/v1`;
                   sessionConfig.provider = {
                    type: 'openai',
                    baseUrl: openAiCompatibleUrl,
                    apiKey: 'ollama',
                  };
                  console.log(`🔧 Creating SDK session with BYOK provider:`);
                  console.log(`   - Original Model: ${model}`);
                  console.log(`   - Normalized Model: ${normalizedModel}`);
                  console.log(`   - Base URL: ${openAiCompatibleUrl}`);
                  console.log(`   - Wire API: completions`);
                } else if (LLM_PROVIDER === 'nvidia' && process.env.NVIDIA_API_KEY) {
                  sessionConfig.provider = {
                    type: 'openai',
                    wireApi: 'completions',
                    baseUrl: 'https://integrate.api.nvidia.com/v1',
                    apiKey: process.env.NVIDIA_API_KEY,
                  };
                  console.log(`🔧 Creating SDK session with NVIDIA NIM provider:`);
                  console.log(`   - Model: ${normalizedModel}`);
                  console.log(`   - Base URL: https://integrate.api.nvidia.com/v1`);
                } else {
                  console.log(`🔧 Creating SDK session with GitHub Cloud provider:`);
                  console.log(`   - Model: ${normalizedModel}`);
                }
                
                let sdkSession;
                try {
                  console.log('📡 Calling copilotClient.createSession...');
                  console.log('📋 Session config:', JSON.stringify({
                    ...sessionConfig,
                    onPermissionRequest: '[Function]'
                  }, null, 2));
                  const sessionPromise = copilotClient.createSession(sessionConfig);
                  const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Session creation timeout (30s)')), 30000);
                  });
                  sdkSession = await Promise.race([sessionPromise, timeoutPromise]);
                  console.log('✅ SDK session created successfully');
                } catch (sessionErr) {
                  console.error('❌ Failed to create Copilot SDK session:', sessionErr.message);
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: `Failed to create chat session: ${sessionErr.message}. Check your BYOK configuration.`
                  }));
                  const locks = creationLocks.get(clientData.userId);
                  if (locks) locks.delete(clientSessionId);
                  return;
                }
                
                sdkSessionId = sdkSession.id || sdkSession.sessionId;
                if (sdkSessionId && dbResult?.sessionId) {
                  updateChatSessionSdkId(dbResult.sessionId, sdkSessionId);
                  console.log(`💾 Saved SDK session ID to database: ${sdkSessionId}`);
                }
                
                chatSessionData = {
                  clientSessionId: clientSessionId,
                  sessionId: dbResult.sessionId,
                  sdkSessionId: sdkSessionId,
                  session: sdkSession,
                  piSessionId: null,
                  agentEngine: 'copilot-sdk',
                  name: sessionName,
                  model: model,
                  workingDirectory: workingDirectory,
                  history: [],
                  lastActivity: Date.now(),
                  currentMode: 'interactive',
                  autoApprove: true,
                  pendingToolCalls: new Map(),
                  totalInputTokens: 0,
                  totalOutputTokens: 0,
                  totalTokens: 0,
                  totalCacheReadTokens: 0,
                  totalCacheWriteTokens: 0,
                  totalReasoningTokens: 0,
                  sdkUsageReceived: false,
                  _sending: false,
                  _sendingTimeout: null
                };
                
                console.log('📡 Setting up SDK session event handlers...');
                setupSessionEventHandlers(sdkSession, clientData.userId, dbResult.sessionId);
              }
              
              // Store in user sessions map (create if not exists)
              let userSessions = chatSessions.get(clientData.userId);
              if (!(userSessions instanceof Map)) {
                userSessions = new Map();
                chatSessions.set(clientData.userId, userSessions);
              }
              userSessions.set(clientSessionId, chatSessionData);
              
              ws.send(JSON.stringify({
                type: 'chat_session_created',
                success: true,
                clientSessionId: clientSessionId,
                serverSessionId: dbResult.sessionId,
                sdkSessionId: sdkSessionId,
                agentEngine: agentEngine,
                name: sessionName,
                model: model,
                provider: chatSessionData.provider,
                workingDirectory: workingDirectory,
                history: []
              }));
              
              console.log(`✅ Chat session created: ${sessionName} (${clientSessionId}) [engine: ${agentEngine}]`);
              
              // Release creation lock
              const locks = creationLocks.get(clientData.userId);
              if (locks) locks.delete(clientSessionId);
            } catch (err) {
              console.error('Chat session creation error:', err);
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: err.message
              }));
              // Release creation lock on error
              const locks = creationLocks.get(clientData.userId);
              if (locks) locks.delete(clientSessionId);
            }
          })();
          break;
          
        case 'chat_session_delete':
          // Delete a specific chat session
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            try {
              let serverSessionId = null;
              let sdkSessionId = null;
              const userSessions = chatSessions.get(clientData.userId);
              
              if (userSessions instanceof Map) {
                // Try lookup by clientSessionId first
                let sessionData = userSessions.get(message.sessionId);
                // If not found, try by serverSessionId (some sessions are keyed by DB id)
                if (!sessionData && message.serverSessionId) {
                  for (const [, s] of userSessions) {
                    if (s.sessionId === message.serverSessionId) {
                      sessionData = s;
                      break;
                    }
                  }
                }
                
                if (sessionData) {
                  // Session found in memory - capture IDs before cleanup
                  serverSessionId = sessionData.sessionId;
                  sdkSessionId = sessionData.sdkSessionId;
                  
                  // End agent session
                  try {
                    if (sessionData.agentEngine === 'pi-agent') {
                      await endPiSession(sessionData.piSessionId || message.sessionId);
                      console.log(`🔌 Ended PI Agent session: ${sessionData.piSessionId || message.sessionId}`);
                    } else {
                      await sessionData.session.disconnect();
                      console.log(`🔌 Disconnected SDK session: ${sdkSessionId}`);
                    }
                  } catch (e) {
                    console.log(`⚠️ Error disconnecting session: ${e.message}`);
                  }
                  
                  // Remove from memory
                  userSessions.delete(message.sessionId);
                  if (message.serverSessionId) {
                    userSessions.delete(message.serverSessionId);
                  }
                }
              }
              
              // If not found in memory but we have serverSessionId from client, use that
              if (!serverSessionId && message.serverSessionId) {
                serverSessionId = message.serverSessionId;
              }
              
              // If we still don't have sdkSessionId, try to get it from database
              if (!sdkSessionId && serverSessionId) {
                try {
                  const dbSession = getChatSessionById(serverSessionId, clientData.userId);
                  if (dbSession?.sdk_session_id) {
                    sdkSessionId = dbSession.sdk_session_id;
                    console.log(`📂 Retrieved SDK session ID from database for deletion: ${sdkSessionId}`);
                  }
                } catch (dbErr) {
                  console.log(`⚠️ Could not retrieve SDK session ID from database: ${dbErr.message}`);
                }
              }
              
              // Delete from SDK if we have an SDK session ID
              if (sdkSessionId && copilotClient?.deleteSession) {
                try {
                  await copilotClient.deleteSession(sdkSessionId);
                  console.log(`🗑️ Deleted SDK session: ${sdkSessionId}`);
                } catch (sdkErr) {
                  console.log(`⚠️ Could not delete SDK session: ${sdkErr.message}`);
                }
              }
              
              // Delete from database using serverSessionId
              if (serverSessionId) {
                const result = deleteChatSession(serverSessionId, clientData.userId);
                console.log(`🗑️ Deleted chat session from database: ${serverSessionId} (success: ${result.success})`);
              } else {
                console.log(`⚠️ Could not delete chat session: no serverSessionId available`);
              }
              
              ws.send(JSON.stringify({
                type: 'chat_session_deleted',
                success: true,
                clientSessionId: message.sessionId
              }));
            } catch (err) {
              console.error('Error deleting chat session:', err);
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: err.message
              }));
            }
          })();
          break;
          
        case 'chat_session_reconnect':
          // Reconnect to an existing chat session (from page refresh)
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            try {
              const agentEngine = message.agentEngine || DEFAULT_AGENT_ENGINE;
              const clientSessionId = message.sessionId;
              const serverSessionId = message.serverSessionId;
              let sdkSessionId = message.sdkSessionId; // SDK session ID from client
              const sessionName = message.name || 'Chat Session';
              const currentDefaultModel = LLM_PROVIDER === 'ollama' ? 'llama3.2' : 'meta/llama-3.1-8b-instruct';
              let model = message.model || currentDefaultModel;
              
              // Resolve working directory and provider/model: message > database > default
              let workingDirectory = message.workingDirectory;
              let dbSession = null;
              if (serverSessionId) {
                dbSession = getChatSessionById(serverSessionId, clientData.userId);
                if (dbSession?.working_directory) {
                  workingDirectory = dbSession.working_directory;
                }
              }
              workingDirectory = ensureWorkingDirectory(workingDirectory || WORKSPACE_DIR);
              
              // Resolve provider: respect session's stored provider from DB
              let sessionProvider = dbSession?.provider || LLM_PROVIDER;
              const storedModel = dbSession?.model || model;

              // If the session's provider is no longer configured (e.g. API key removed),
              // fall back to the global provider and update the session
              const providerConfigured =
                (sessionProvider === 'ollama' && !!process.env.OLLAMA_HOST) ||
                (sessionProvider === 'nvidia' && !!process.env.NVIDIA_API_KEY);
              if (!providerConfigured) {
                const fallbackProvider = LLM_PROVIDER;
                const fallbackModel = fallbackProvider === 'ollama' ? 'llama3.2' : 'meta/llama-3.1-8b-instruct';
                console.log(`🔄 Provider "${sessionProvider}" no longer configured for session ${serverSessionId}. Falling back to ${fallbackProvider} with model ${fallbackModel}`);
                sessionProvider = fallbackProvider;
                model = fallbackModel;
                if (serverSessionId) {
                  updateChatSessionModel(serverSessionId, model, sessionProvider);
                }
                ws.send(JSON.stringify({
                  type: 'chat_provider_changed',
                  sessionId: serverSessionId,
                  provider: sessionProvider,
                  model: fallbackModel,
                  reason: 'provider_no_longer_configured',
                  message: `Session provider switched to ${fallbackProvider} because ${dbSession?.provider || 'the previous provider'} is no longer configured.`
                }));
              } else if (serverSessionId && !message.model && dbSession?.model) {
                // Same provider: if client didn't send a model, trust the DB record
                model = dbSession.model;
              }
              
              // Check if session already exists in memory
              const userSessions = chatSessions.get(clientData.userId);
              if (userSessions instanceof Map && userSessions.has(clientSessionId)) {
                // Already connected - just confirm, but fetch latest history from DB to ensure completeness
                const existingSession = userSessions.get(clientSessionId);
                // CRITICAL: Reset _sending flag so user can send messages after reconnect
                existingSession._sending = false;
                if (existingSession._sendingTimeout) { clearTimeout(existingSession._sendingTimeout); existingSession._sendingTimeout = null; }
                // CRITICAL: Re-wire PI session events with the new WebSocket
                // After page refresh, the old ws is closed (state=3) and events get dropped
                if (existingSession.agentEngine === 'pi-agent' && existingSession.piSessionId) {
                  const piSessionMap = getPiSession(clientSessionId);
                  if (piSessionMap) {
                    console.log(`🔌 Re-wiring PI session events for ${clientSessionId} with new WebSocket`);
                    wirePiSessionEvents(piSessionMap, ws, clientSessionId, clientData, existingSession.sessionId);
                  } else {
                    console.warn(`⚠️ PI session ${existingSession.piSessionId} not found for re-wiring`);
                  }
                }
                const existingMessages = getRecentChatMessages(existingSession.sessionId, 100);
                ws.send(JSON.stringify({
                  type: 'chat_session_created',
                  success: true,
                  clientSessionId: clientSessionId,
                  serverSessionId: existingSession.sessionId,
                  sdkSessionId: existingSession.sdkSessionId,
                  agentEngine: existingSession.agentEngine || 'copilot-sdk',
                  name: existingSession.name,
                  model: existingSession.model,
                  provider: existingSession.provider,
                  workingDirectory: existingSession.workingDirectory,
                  history: existingMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })) || []
                }));
                return;
              }
              
              if (agentEngine === 'pi-agent') {
                // PI Agent reconnection: use native session file if available, else start fresh
                const piProviderConfig = buildPiProviderConfig(sessionProvider);
                if (!piProviderConfig) {
                  console.warn('⚠️  Cannot reconnect PI Agent session — no valid provider config. Check LLM_PROVIDER and API keys.');
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: 'PI Agent engine requires a configured Ollama or NVIDIA NIM provider. Check your environment variables.'
                  }));
                  return;
                }
                let piSessionFile = null;
                if (serverSessionId && dbSession) {
                  if (dbSession.agent_engine !== 'pi-agent') {
                    updateChatSessionAgentEngine(serverSessionId, 'pi-agent');
                  }
                  piSessionFile = dbSession.pi_session_file || null;
                }
                // If provider changed from what was stored, don't restore from old provider's session file
                if (dbSession?.provider && dbSession.provider !== sessionProvider) {
                  piSessionFile = null;
                }

                // Validate model is still available for NVIDIA before reconnecting
                if (sessionProvider === 'nvidia') {
                  const isValid = await validateNvidiaModel(model);
                  if (!isValid) {
                    const fallback = sessionProvider === 'nvidia' ? 'meta/llama-3.1-8b-instruct' : 'llama3.2';
                    console.warn(`⚠️ Reconnect model "${model}" not valid for NVIDIA, switching to fallback: ${fallback}`);
                    model = fallback;
                    if (serverSessionId) {
                      updateChatSessionModel(serverSessionId, model, sessionProvider);
                    }
                    ws.send(JSON.stringify({
                      type: 'chat_model_changed',
                      sessionId: serverSessionId,
                      model: fallback,
                      reason: 'reconnect_model_unavailable',
                      message: `Model switched to ${fallback} (previous model no longer available on NVIDIA)`
                    }));
                  }
                }
                
                let piSession;
                if (piSessionFile && existsSync(piSessionFile)) {
                  console.log(`🔄 Restoring PI Agent session from native file: ${piSessionFile}`);
                  piSession = await restorePiSession(clientSessionId, sessionName, model, workingDirectory, piSessionFile, piProviderConfig);
                  // Native session restored — PI loads all prior conversation state from file
                } else {
                  console.log(`🔄 Creating fresh PI Agent session (no previous session file)`);
                  piSession = await createPiSession(clientSessionId, sessionName, model, workingDirectory, piProviderConfig);
                  if (piSession.sessionFile && serverSessionId) {
                    updateChatSessionPiFile(serverSessionId, piSession.sessionFile);
                  }
                }
                
                wirePiSessionEvents(piSession, ws, clientSessionId, clientData, serverSessionId);
                
                const existingMessages = serverSessionId ? getRecentChatMessages(serverSessionId, 100) : [];
                
                const chatSessionData = {
                  clientSessionId: clientSessionId,
                  sessionId: serverSessionId,
                  sdkSessionId: null,
                  session: null,
                  piSessionId: clientSessionId,
                  agentEngine: 'pi-agent',
                  name: sessionName,
                  model: model,
                  provider: sessionProvider,
                  workingDirectory: workingDirectory,
                  history: existingMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
                  lastActivity: Date.now(),
                  currentMode: 'interactive',
                  autoApprove: true,
                  pendingToolCalls: new Map(),
                  totalInputTokens: 0,
                  totalOutputTokens: 0,
                  totalTokens: 0,
                  totalCacheReadTokens: 0,
                  totalCacheWriteTokens: 0,
                  totalReasoningTokens: 0,
                  sdkUsageReceived: false,
                  _sending: false,
                  _sendingTimeout: null
                };
                
                let sessionStore = chatSessions.get(clientData.userId);
                if (!(sessionStore instanceof Map)) { sessionStore = new Map(); chatSessions.set(clientData.userId, sessionStore); }
                sessionStore.set(clientSessionId, chatSessionData);
                
                ws.send(JSON.stringify({
                  type: 'chat_session_created',
                  success: true,
                  clientSessionId: clientSessionId,
                  serverSessionId: serverSessionId,
                  sdkSessionId: null,
                  agentEngine: 'pi-agent',
                  name: sessionName,
                  model: model,
                  provider: sessionProvider,
                  workingDirectory: workingDirectory,
                  history: existingMessages
                }));
                
                console.log(`✅ PI Agent session reconnected: ${sessionName} (${clientSessionId})`);
                return;
              }
              
              // Copilot SDK reconnection
              if (!CopilotClient) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Copilot SDK not installed'
                }));
                return;
              }
              
              if (!copilotClient) {
                await initCopilotClient();
              }
              
              if (!copilotClient) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Failed to initialize Copilot client'
                }));
                return;
              }
              
              // If no SDK session ID provided, try to get it from the database
              if (!sdkSessionId && serverSessionId) {
                const dbSession = getChatSessionById(serverSessionId, clientData.userId);
                if (dbSession?.sdk_session_id) {
                  sdkSessionId = dbSession.sdk_session_id;
                  console.log(`📂 Retrieved SDK session ID from database: ${sdkSessionId}`);
                }
              }
              
              // Use initCopilotChatSession which properly handles SDK session resumption
              console.log(`🔄 Reconnecting chat session: ${sessionName} (${clientSessionId})`);
              console.log(`   - Server Session ID: ${serverSessionId}`);
              console.log(`   - SDK Session ID: ${sdkSessionId || 'Not provided - will create new'}`);
              
              const result = await initCopilotChatSession(clientData.userId, model, sdkSessionId, workingDirectory, serverSessionId);
              
              if (!result || !result.session) {
                throw new Error('Failed to initialize Copilot chat session');
              }
              
              // Update the database session with the new SDK session ID if it changed
              if (result.sdkSessionId && result.sdkSessionId !== sdkSessionId) {
                updateChatSessionSdkId(serverSessionId, result.sdkSessionId);
              }
              
              // Get existing messages from database for client history
              const existingMessages = getRecentChatMessages(serverSessionId, 100);
              
              // Update the session data stored by initCopilotChatSession with client-specific info.
              // CRITICAL: initCopilotChatSession stores the session object under serverSessionId
              // with all required fields (_sending, _sendingTimeout). chat_send looks up by
              // clientSessionId. We MUST use the SAME object so SDK callbacks and chat_send
              // operate on one consistent session data object.
              const userSessionStore = chatSessions.get(clientData.userId);
              const sdkSessionData = userSessionStore?.get(serverSessionId);
              const chatSessionData = sdkSessionData || userSessionStore?.get(clientSessionId) || {
                session: result.session,
                sdkSessionId: result.sdkSessionId,
                sessionId: serverSessionId,
                history: [],
                lastActivity: Date.now(),
                currentMode: 'interactive',
                autoApprove: false,
                pendingToolCalls: new Map(),
                _sending: false,
                _sendingTimeout: null
              };
              
              // CRITICAL FIX: Ensure the clientSessionId entry points to the new live SDK session.
              // initCopilotChatSession stores the new session under serverSessionId, but chat_send
              // looks up by clientSessionId. If we don't update these properties here, the old
              // dead SDK session remains in the clientSessionId slot, causing messages to fail.
              chatSessionData.session = result.session;
              chatSessionData.sdkSessionId = result.sdkSessionId;
              chatSessionData.sessionId = serverSessionId;
              
              // Add client-specific properties
              chatSessionData.clientSessionId = clientSessionId;
              chatSessionData.name = sessionName;
              chatSessionData.model = model;
              chatSessionData.workingDirectory = workingDirectory;
              chatSessionData.agentEngine = 'copilot-sdk';
              
              // Merge existing messages with any current history
              if (existingMessages.length > 0) {
                chatSessionData.history = existingMessages.map(m => ({
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp
                }));
              }
              
              // Event handlers are already set up by initCopilotChatSession via setupSessionEventHandlers
              // which now includes sessionId in all broadcasts. No need for duplicate inline handlers.
              
              // Store in user sessions map
              let sessionStore = chatSessions.get(clientData.userId);
              if (!(sessionStore instanceof Map)) {
                // Convert or create new Map storage
                sessionStore = new Map();
                chatSessions.set(clientData.userId, sessionStore);
              }
              sessionStore.set(clientSessionId, chatSessionData);
              
              // Send success response
              ws.send(JSON.stringify({
                type: 'chat_session_created',
                success: true,
                clientSessionId: clientSessionId,
                serverSessionId: serverSessionId,
                sdkSessionId: result.sdkSessionId,
                agentEngine: 'copilot-sdk',
                name: sessionName,
                model: model,
                provider: sessionProvider,
                workingDirectory: workingDirectory,
                history: existingMessages
              }));
              
              console.log(`✅ Chat session reconnected: ${sessionName} (${clientSessionId})`);
              console.log(`   - SDK Session: ${result.sdkSessionId}`);
            } catch (err) {
              console.error('❌ Chat session reconnect error:', err);
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: `Failed to reconnect: ${err.message}`
              }));
            }
          })();
          break;
          
        case 'chat_session_rename':
          // Rename a chat session
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            try {
              const userSessions = chatSessions.get(clientData.userId);
              if (userSessions instanceof Map) {
                const sessionData = userSessions.get(message.sessionId);
                if (sessionData && message.name) {
                  sessionData.name = message.name;
                  
                  // Update in database
                  renameChatSession(sessionData.sessionId, clientData.userId, message.name);
                }
              }
              
              ws.send(JSON.stringify({
                type: 'chat_session_renamed',
                success: true,
                clientSessionId: message.sessionId,
                name: message.name
              }));
            } catch (err) {
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: err.message
              }));
            }
          })();
          break;
          
        case 'chat_session_clear':
          // Clear a specific chat session (delete messages but keep session)
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            try {
              const userSessions = chatSessions.get(clientData.userId);
              if (userSessions instanceof Map) {
                const sessionData = userSessions.get(message.sessionId);
                if (sessionData) {
                  // Clear messages from database
                  clearChatMessages(sessionData.sessionId);
                  
                  // Clear in-memory history
                  sessionData.history = [];
                }
              }
              
              ws.send(JSON.stringify({
                type: 'chat_session_cleared',
                success: true,
                clientSessionId: message.sessionId
              }));
            } catch (err) {
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: err.message
              }));
            }
          })();
          break;
          
        case 'chat_send':
          // Send message to specific chat session
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            let sessionData = null;
            let sessionId = null;
            try {
              const userSessions = chatSessions.get(clientData.userId);
              sessionId = message.sessionId;
              
              if (!(userSessions instanceof Map) || !sessionId) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Chat session not found'
                }));
                return;
              }
              
              sessionData = userSessions.get(sessionId);
              
              if (!sessionData) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Chat session not initialized'
                }));
                return;
              }

              // Validate model is still available before sending
              if (sessionData.agentEngine === 'pi-agent' && sessionData.provider === 'nvidia') {
                const isValid = await validateNvidiaModel(sessionData.model);
                if (!isValid) {
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    sessionId: sessionId,
                    message: `Model "${sessionData.model}" is not available on NVIDIA NIM. Please switch to a different model in Settings.`
                  }));
                  return;
                }
              }
              
              // Add user message to history
              if (sessionData._sending) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  sessionId: sessionId,
                  message: 'A response is already being generated. Please wait for it to complete before sending another message.'
                }));
                return;
              }
              sessionData._sending = true;
              // Safety net: if _sending is still true after 90 seconds,
              // reset it so the user isn't permanently blocked
              sessionData._sendingTimeout = setTimeout(() => {
                if (sessionData._sending) {
                  console.warn(`⚠️ _sending flag stuck for session ${sessionId} — resetting after timeout`);
                  sessionData._sending = false;
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    sessionId: message.sessionId,
                    message: 'Response timed out. Please try again.'
                  }));
                }
              }, 90000);
              
              sessionData.history.push({
                role: 'user',
                content: message.message,
                timestamp: Date.now()
              });
              sessionData.lastActivity = Date.now();
              
              // Persist user message to database
              addChatMessage(sessionData.sessionId, 'user', message.message);
              
              // Send confirmation
              ws.send(JSON.stringify({
                type: 'chat_message_sent',
                sessionId: sessionId,
                message: message.message
              }));
              
              // Build prompt with working directory context if available
              let promptText = message.message;
              if (sessionData.workingDirectory && sessionData.workingDirectory !== WORKSPACE_DIR) {
                // Prepend working directory context to help the agent know the project location
                promptText = `[Working Directory: ${sessionData.workingDirectory}]\n\n${message.message}`;
                console.log(`📁 Adding working directory context: ${sessionData.workingDirectory}`);
              }
              
              // Handle image attachment: read file and convert to base64 for PI SDK
              let images = null;
              if (message.imagePath && existsSync(message.imagePath)) {
                try {
                  const imageBuffer = await readFile(message.imagePath);
                  const ext = path.extname(message.imagePath).toLowerCase();
                  const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
                  const base64Data = imageBuffer.toString('base64');
                  // PI SDK expects flat format: { type: 'image', mimeType, data }
                  // The SDK's providers convert this to each backend's required format
                  images = [{ type: 'image', mimeType, data: base64Data }];
                  console.log(`🖼️ Image attached: ${message.imagePath} (${mimeType}, ${Math.round(base64Data.length / 1024)}KB base64)`);
                } catch (imgErr) {
                  console.warn(`⚠️ Failed to read image: ${imgErr.message}`);
                }
              }
              
              // Route to selected agent engine
              if (sessionData.agentEngine === 'pi-agent') {
                console.log(`📤 Sending prompt to PI Agent (session: ${sessionId}, piSessionId: ${sessionData.piSessionId})...`);
                try {
                  const sendPromise = sendPiPrompt(sessionData.piSessionId || sessionId, promptText, images);
                  const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('PI Agent request timed out after 120 seconds.')), 120000);
                  });
                  await Promise.race([sendPromise, timeoutPromise]);
                  console.log(`✅ Prompt completed successfully for PI Agent (session: ${sessionId})`);
                } catch (piErr) {
                  console.error(`❌ PI Agent prompt failed (session: ${sessionId}):`, piErr.message);
                  throw piErr;
                }
              } else {
                // Send to Copilot SDK with timeout
                if (!sessionData.sdkUsageReceived) {
                  sessionData.totalInputTokens += estimateTokens(promptText);
                }
                console.log(`📤 Sending prompt to ${LLM_PROVIDER} provider (session: ${sessionId})...`);
                const sendPromise = sessionData.session.send({ prompt: promptText });
                const timeoutPromise = new Promise((_, reject) => {
                  setTimeout(() => reject(new Error('LLM request timed out after 120 seconds. The provider may be unresponsive.')), 120000);
                });
                await Promise.race([sendPromise, timeoutPromise]);
                console.log(`✅ Prompt sent successfully to ${LLM_PROVIDER} (session: ${sessionId})`);
              }
            } catch (err) {
              if (sessionData) {
                sessionData._sending = false;
                if (sessionData._sendingTimeout) { clearTimeout(sessionData._sendingTimeout); sessionData._sendingTimeout = null; }
              }
              ws.send(JSON.stringify({
                type: 'chat_error',
                sessionId: sessionId || message.sessionId,
                message: err.message
              }));
            }
          })();
          break;
          
        case 'chat_clear':
          // Clear chat history - now redirects to clear all sessions or current session
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          // For backwards compatibility, treat as clearing all sessions
          (async () => {
            const userSessions = chatSessions.get(clientData.userId);
            if (userSessions instanceof Map) {
              for (const [sessionId, sessionData] of userSessions) {
                try {
                  if (sessionData.agentEngine === 'pi-agent') {
                    await endPiSession(sessionData.piSessionId || sessionId);
                  } else {
                    await sessionData.session.disconnect();
                  }
                } catch (e) {}
                closeChatSession(sessionData.sessionId);
              }
              userSessions.clear();
            }
            
            ws.send(JSON.stringify({
              type: 'chat_cleared',
              success: true
            }));
          })();
          break;
          
        case 'permission_response':
          // Handle user's response to a permission request
          (async () => {
            const { requestId, approved } = message;
            const pending = pendingPermissions.get(requestId);
            
            if (pending) {
              pendingPermissions.delete(requestId);
              if (approved) {
                pending.resolve({ kind: 'approve-once' });
              } else {
                pending.resolve({ kind: 'reject' });
              }

              // CRITICAL FIX: Broadcast permission_resolved to ALL user devices
              // so other clients (desktop, mobile) can dismiss their stale permission UIs
              for (const [ws, clientData] of clients) {
                if (clientData.userId === pending.userId && ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    type: 'permission_resolved',
                    requestId,
                    approved,
                    resolvedBy: 'another_device'
                  }));
                }
              }
            } else {
              console.warn(`No pending permission request found: ${requestId}`);
            }
          })();
          break;
          
        case 'user_input_response':
          // Handle user's response to an input request
          (async () => {
            const { requestId, value } = message;
            const pending = pendingUserInputs.get(requestId);
            
            if (pending) {
              pendingUserInputs.delete(requestId);
              pending.resolve(value || '');

              // CRITICAL FIX: Broadcast user_input_resolved to ALL user devices
              for (const [ws, clientData] of clients) {
                if (clientData.userId === pending.userId && ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    type: 'user_input_resolved',
                    requestId,
                    resolvedBy: 'another_device'
                  }));
                }
              }
            } else {
              console.warn(`No pending user input request found: ${requestId}`);
            }
          })();
          break;
          
        case 'extension_ui_response':
          // Handle PI Agent extension UI responses (permission/user-input)
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          (async () => {
            const { requestId, sessionId, approved, value } = message;
            try {
              const userSessions = chatSessions.get(clientData.userId);
              const sessionData = userSessions instanceof Map ? userSessions.get(sessionId) : null;
              const piSid = sessionData?.piSessionId || sessionId;
              await respondToPiExtensionUI(piSid, requestId, { approved, value });
              ws.send(JSON.stringify({ type: 'extension_ui_resolved', requestId, approved }));
            } catch (err) {
              ws.send(JSON.stringify({ type: 'chat_error', message: err.message }));
            }
          })();
          break;
          
        case 'chat_command':
          // Handle slash commands for PI Agent
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            const { command, sessionId } = message;
            const userSessions = chatSessions.get(clientData.userId);
            
            if (!(userSessions instanceof Map)) {
              ws.send(JSON.stringify({ type: 'chat_error', message: 'No active session' }));
              return;
            }
            
            let sessionData = userSessions.get(sessionId);
            if (!sessionData) {
              sessionData = Array.from(userSessions.values())[0];
            }
            
            if (!sessionData) {
              ws.send(JSON.stringify({ type: 'chat_error', message: 'No active session' }));
              return;
            }
            
            try {
              let result = { success: true };
              
              switch (command) {
                case '/interrupt':
                case '/stop':
                  if (sessionData.agentEngine === 'pi-agent') {
                    abortPiSession(sessionData.piSessionId || sessionId);
                    result.message = 'PI Agent operation interrupted';
                  } else {
                    result.message = 'No session available to interrupt';
                    result.success = false;
                  }
                  break;
                  
                case '/clear':
                  sessionData.history = [];
                  if (sessionData.sessionId) {
                    clearChatMessages(sessionData.sessionId);
                  }
                  result.message = 'Chat history cleared';
                  break;
                  
                default:
                  result.success = false;
                  result.message = `Unknown command: ${command}. Available commands: /interrupt, /stop, /clear`;
              }
              
              ws.send(JSON.stringify({
                type: 'command_result',
                command,
                ...result
              }));
              
            } catch (err) {
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: `Command failed: ${err.message}`
              }));
            }
          })();
          break;
          
        case 'chat_interrupt':
          // Interrupt current chat operation
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            const userSessions = chatSessions.get(clientData.userId);
            if (!(userSessions instanceof Map)) {
              ws.send(JSON.stringify({ type: 'chat_error', message: 'No active session' }));
              return;
            }
            
            // Use explicit sessionId if provided, otherwise fall back to first active session
            const sessionId = message.sessionId;
            let sessionData;
            if (sessionId && userSessions.has(sessionId)) {
              sessionData = userSessions.get(sessionId);
            } else {
              sessionData = Array.from(userSessions.values())[0];
            }
            if (!sessionData) {
              ws.send(JSON.stringify({ type: 'chat_error', message: 'No active session' }));
              return;
            }
            
            try {
              if (sessionData.agentEngine === 'pi-agent') {
                abortPiSession(sessionData.piSessionId || sessionData.clientSessionId);
                ws.send(JSON.stringify({ type: 'interrupt_success' }));
              } else if (sessionData?.session) {
                await sessionData.session.interrupt();
                ws.send(JSON.stringify({ type: 'interrupt_success' }));
              } else {
                ws.send(JSON.stringify({ type: 'chat_error', message: 'Session not interruptible' }));
              }
            } catch (err) {
              ws.send(JSON.stringify({ type: 'chat_error', message: err.message }));
            }
          })();
          break;
          
        case 'get_session_info':
          // Get info about current session for persistence/resume
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            const userSessions = chatSessions.get(clientData.userId);
            if (!userSessions) {
              ws.send(JSON.stringify({ type: 'session_info', hasSession: false }));
              return;
            }
            
            const sessionData = Array.from(userSessions.values())[0];
            ws.send(JSON.stringify({
              type: 'session_info',
              hasSession: true,
              sdkSessionId: sessionData?.sdkSessionId,
              dbSessionId: sessionData?.sessionId,
              agentEngine: sessionData?.agentEngine || 'copilot-sdk',
              model: sessionData?.model || (LLM_PROVIDER === 'ollama' ? 'llama3.2' : 'meta/llama-3.1-8b-instruct'),
              mode: sessionData?.currentMode || 'interactive',
              historyLength: sessionData?.history?.length || 0
            }));
          })();
          break;
          
        case 'resume_session':
          // Resume a previous SDK session
          if (!clientData.authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }
          
          (async () => {
            const { sdkSessionId } = message;
            
            try {
              const result = await initCopilotChatSession(clientData.userId, null, sdkSessionId);
              
              ws.send(JSON.stringify({
                type: 'session_resumed',
                success: true,
                sdkSessionId: result.sdkSessionId,
                sessionId: result.sessionId,
                history: result.history
              }));
            } catch (err) {
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: `Failed to resume session: ${err.message}`
              }));
            }
          })();
          break;
          
        default:
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: `Unknown message type: ${message.type}` 
          }));
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    const clientData = clients.get(ws);
    
    // Mark terminals OWNED BY THIS WEBSOCKET as disconnected (keep them alive indefinitely)
    if (clientData?.userId) {
      for (const [key, t] of terminals) {
        if (t.userId === clientData.userId && t.ws === ws) {
          t.ws = null; // Mark as disconnected
          t.disconnectedAt = Date.now();
          console.log(`Terminal ${t.terminalId} disconnected (user ${clientData.userId}) — will persist until user closes it`);
        }
      }
    }
    
    clients.delete(ws);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Normalize HOST to avoid IPv6 binding issues on Windows when 'localhost' resolves to ::1
const BIND_HOST = (HOST === 'localhost' || HOST === '127.0.0.1') ? '127.0.0.1' : HOST;

// Start server
server.listen(PORT, BIND_HOST, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║      Terminal Web UI Server Started        ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  URL:     http://${HOST}:${PORT}                     ║`);
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Workspace: ${WORKSPACE_DIR}`);
  console.log('║  Auth: Required (see default credentials)  ║');
  console.log('╚════════════════════════════════════════════╝');

  // Auto-start TTS if enabled
  if (TTS_ENABLED) {
    setTimeout(() => {
      startTtsWorker();
    }, 2000);
  }
});

// Cleanup orphaned chat sessions and old TTS files periodically.
// NOTE: Terminals are NEVER auto-killed. They persist until:
//   1. The user explicitly clicks "Close Terminal" (close_terminal WS message)
//   2. The shell process exits naturally (ptyProcess.onExit)
//   3. The server shuts down (SIGTERM / SIGINT)
//   4. The user explicitly logs out (logout WS message)
setInterval(() => {
  const now = Date.now();
  
  // Cleanup chat sessions (keep idle ones longer but still purge eventually)
  for (const [userId, userSessions] of chatSessions) {
    let hasActive = false;
    for (const [sessionId, chatData] of userSessions) {
      if (now - chatData.lastActivity > CHAT_GRACE_PERIOD) {
        console.log(`Cleaning up expired chat session ${sessionId} for user ${userId}`);
        try {
          if (chatData.agentEngine === 'pi-agent') {
            endPiSession(chatData.piSessionId || sessionId);
          } else if (chatData.session) {
            chatData.session.disconnect();
          }
        } catch (e) {}
        userSessions.delete(sessionId);
      } else {
        hasActive = true;
      }
    }
    if (!hasActive) {
      chatSessions.delete(userId);
    }
  }

  // Cleanup old TTS audio files
  (async () => {
    try {
      const ttsDir = pathJoin(__dirname, 'tts');
      if (existsSync(ttsDir)) {
        const entries = await readdir(ttsDir);
        let deleted = 0;
        for (const entry of entries) {
          const filePath = pathJoin(ttsDir, entry);
          const stats = await stat(filePath);
          if (now - stats.mtimeMs > TTS_FILE_AGE_MS) {
            try { await unlink(filePath); deleted++; } catch (e) {}
          }
        }
        if (deleted > 0) console.log(`Cleaned up ${deleted} old TTS audio files`);
      }
    } catch (e) {
      // silently ignore cleanup errors
    }
  })();
}, 60000); // Run every minute

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  closeDatabase();
  
  // Cleanup terminals
  for (const [key, term] of terminals) {
    try { term.pty.kill(); } catch (e) {}
  }
  
  // Cleanup chat sessions
  for (const [userId, userSessions] of chatSessions) {
    for (const [sessionId, chatData] of userSessions) {
      try {
        if (chatData.agentEngine === 'pi-agent') {
          await endPiSession(chatData.piSessionId || sessionId);
        } else {
          await chatData.session.disconnect();
        }
      } catch (e) {}
    }
  }
  chatSessions.clear();
  
  // Stop Copilot client
  if (copilotClient) {
    try {
      await copilotClient.stop();
    } catch (e) {}
  }
  
  server.close(() => {
    process.exit(0);
  });
});



