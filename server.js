/**
 * Web Terminal Server
 * Simplified version - directory browser + terminal only
 * With Authentication
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { config } from 'dotenv';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import * as pty from 'node-pty';
import { platform } from 'os';
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
  updateChatSessionSummary,
  getChatSessions,
  updateChatSessionActivity,
  updateChatSessionModel,
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

// GitHub Copilot SDK (optional)
let CopilotClient, approveAll;
try {
  const copilotSdk = await import('@github/copilot-sdk');
  CopilotClient = copilotSdk.CopilotClient;
  approveAll = copilotSdk.approveAll;
  console.log('✅ GitHub Copilot SDK loaded');
} catch (err) {
  console.log('⚠️  GitHub Copilot SDK not available:', err.message);
}

// Import CLI Adapter (alternative to SDK)
import {
  createCliSession,
  resumeCliSession,
  sendToCliSession,
  getCliSession,
  endCliSession,
  listCliSessions
} from './copilot-cli-adapter.js';

// Configuration: Use CLI or SDK
const USE_COPILOT_CLI = process.env.USE_COPILOT_CLI === 'true';
if (USE_COPILOT_CLI) {
  console.log('🔧 Using Copilot CLI mode (instead of SDK)');
}

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

console.log('Configuration:');
console.log('  PORT:', PORT);
console.log('  HOST:', HOST);
console.log('  OLLAMA_HOST:', process.env.OLLAMA_HOST || 'http://localhost:11434 (default)');

// ==========================================
// Terminal Detection
// ==========================================

function detectAvailableTerminals() {
  const terminals = [];
  const isWindows = platform() === 'win32';
  
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
    // Unix/Linux/Mac systems
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
const TERM_GRACE_PERIOD = 5 * 60 * 1000; // 5 minutes grace period for reconnection

// Store active Copilot chat sessions
const chatSessions = new Map(); // userId -> Map(clientSessionId -> { clientSessionId, serverSessionId, sdkSession, name, model, history, lastActivity })
const CHAT_GRACE_PERIOD = 30 * 60 * 1000; // 30 minutes grace period for chat sessions
let copilotClient = null;

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
// Copilot Chat Functions
// ==========================================

async function initCopilotClient() {
  if (!CopilotClient) {
    console.log('⚠️  Copilot SDK not available');
    return false;
  }
  
  try {
    const options = {
      logLevel: process.env.DEBUG === 'true' ? 'debug' : 'info',
      autoStart: false,
      useStdio: true // Use stdio transport for more reliable communication
    };
    
    // Use GitHub token if available (for GitHub cloud models)
    if (process.env.GITHUB_TOKEN) {
      options.gitHubToken = process.env.GITHUB_TOKEN;
      options.useLoggedInUser = false;
    }
    
    // For BYOK, provide custom model listing so listModels() returns available models
    if (process.env.OLLAMA_HOST) {
      const ollamaModels = await getAvailableOllamaModels();
      if (ollamaModels.length > 0) {
        options.onListModels = () => {
          return ollamaModels.map(m => ({
            id: m.name || m.model,
            name: m.name || m.model,
            provider: 'ollama'
          }));
        };
        console.log(`📋 Registered ${ollamaModels.length} models for SDK`);
      }
    }
    
    // Log the SDK client options (without sensitive data)
    console.log('🔧 CopilotClient options:', {
      logLevel: options.logLevel,
      autoStart: options.autoStart,
      useStdio: options.useStdio,
      hasGitHubToken: !!options.gitHubToken,
      hasOnListModels: !!options.onListModels
    });
    
    copilotClient = new CopilotClient(options);
    
    // Set up event listeners for client lifecycle events
    copilotClient.on('session.created', (event) => {
      console.log('📎 SDK event: session.created', event.sessionId);
    });
    
    copilotClient.on('session.deleted', (event) => {
      console.log('📎 SDK event: session.deleted', event.sessionId);
    });
    
    await copilotClient.start();
    console.log('✅ Copilot client initialized');
    console.log('📡 SDK Client state:', copilotClient.getState());
    
    // Log BYOK configuration status
    if (process.env.OLLAMA_HOST) {
      console.log(`✅ BYOK Provider available: ${process.env.OLLAMA_HOST}`);
      
      // Test SDK connection to Ollama by listing models
      try {
        const sdkModels = await copilotClient.listModels();
        console.log(`✅ SDK can list ${sdkModels?.length || 0} models from provider`);
      } catch (modelErr) {
        console.warn('⚠️  SDK could not list models:', modelErr.message);
      }
    }
    
    return true;
  } catch (err) {
    console.error('❌ Failed to initialize Copilot client:', err.message);
    copilotClient = null;
    return false;
  }
}

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

// Store for pending permission requests and user input requests
const pendingPermissions = new Map(); // requestId -> { resolve, reject, ws }
const pendingUserInputs = new Map(); // requestId -> { resolve, reject, ws }

// Permission handler that asks the user for approval
function createPermissionHandler(userId) {
  return async (request, invocation) => {
    const requestId = `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      // Store the promise callbacks
      pendingPermissions.set(requestId, { resolve, reject, userId });
      
      // Find all WebSocket connections for this user and send permission request
      for (const [ws, clientData] of clients) {
        if (clientData.userId === userId && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'permission_request',
            requestId,
            permission: {
              kind: request.kind,
              message: request.message || `Permission required: ${request.kind}`,
              details: request.details || {},
              tool: request.tool || null,
              path: request.path || null,
              command: request.command || null
            },
            timeout: 60000 // 60 second timeout
          }));
        }
      }
      
      // Set timeout for permission request
      setTimeout(() => {
        if (pendingPermissions.has(requestId)) {
          pendingPermissions.delete(requestId);
          reject(new Error('Permission request timeout'));
        }
      }, 60000);
    });
  };
}

// User input handler for ask_user tool
function createUserInputHandler(userId) {
  return async (request) => {
    const requestId = `input_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      pendingUserInputs.set(requestId, { resolve, reject, userId });
      
      for (const [ws, clientData] of clients) {
        if (clientData.userId === userId && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'user_input_request',
            requestId,
            prompt: request.prompt || 'Please provide input',
            placeholder: request.placeholder || '',
            defaultValue: request.defaultValue || ''
          }));
        }
      }
      
      setTimeout(() => {
        if (pendingUserInputs.has(requestId)) {
          pendingUserInputs.delete(requestId);
          reject(new Error('User input request timeout'));
        }
      }, 300000); // 5 minute timeout
    });
  };
}

async function initCopilotChatSession(userId, model = null, sdkSessionId = null) {
  if (!copilotClient) {
    throw new Error('Copilot client not initialized');
  }
  
  const sessionConfig = {
    onPermissionRequest: createPermissionHandler(userId),
    onUserInputRequest: createUserInputHandler(userId),
    workingDirectory: WORKSPACE_DIR,
    enableConfigDiscovery: true,
  };
  
  // Use the provided model or fallback to default
  const useModel = model || 'llama3.2';
  sessionConfig.model = useModel;
  
  // Configure BYOK provider if OLLAMA_HOST is set
  const provider = process.env.OLLAMA_HOST ? 'byok' : null;
  
  if (process.env.OLLAMA_HOST) {
    const ollamaBaseUrl = process.env.OLLAMA_HOST.replace(/\/$/, '');
    const openAiCompatibleUrl = ollamaBaseUrl.endsWith('/v1') ? ollamaBaseUrl : `${ollamaBaseUrl}/v1`;
    sessionConfig.provider = {
      type: 'openai',
      baseUrl: openAiCompatibleUrl,
      apiKey: 'ollama' // Ollama requires any non-empty API key
    };
    console.log(`🔧 BYOK Provider configured: ${openAiCompatibleUrl}`);
  }
  
  if (!process.env.OLLAMA_HOST) {
    console.warn('⚠️ OLLAMA_HOST not configured. Chat may not work.');
  }
  
  let sessionId;
  let history = [];
  let sdkSession;
  let actualSdkSessionId;
  
  // Try to resume existing SDK session if we have an SDK session ID
  if (sdkSessionId) {
    console.log(`📂 Attempting to resume SDK session ${sdkSessionId} for user ${userId}`);
    
    try {
      // First check if we have an existing DB session with this SDK ID to get the model
      const existingDbSession = getChatSessionBySdkId(userId, sdkSessionId);
      if (existingDbSession) {
        // Use the model from the existing session
        const sessionModel = existingDbSession.model || 'llama3.2';
        sessionConfig.model = sessionModel;
        console.log(`🔧 Using model from existing session: ${sessionModel}`);
      }
      
      sdkSession = await copilotClient.resumeSession(sdkSessionId, sessionConfig);
      actualSdkSessionId = sdkSession.id || sdkSession.sessionId;
      console.log(`✅ Successfully resumed SDK session: ${actualSdkSessionId}`);
      
      // Get messages from SDK session
      try {
        const sdkMessages = await sdkSession.getMessages();
        history = sdkMessages.map(msg => ({
          role: msg.data?.role || (msg.type === 'user.message' ? 'user' : 'assistant'),
          content: msg.data?.content || '',
          timestamp: Date.now()
        }));
        console.log(`📜 Loaded ${history.length} messages from SDK session`);
      } catch (msgErr) {
        console.log(`⚠️ Could not load SDK session messages: ${msgErr.message}`);
      }
      
      // Use the existing DB session ID
      if (existingDbSession) {
        sessionId = existingDbSession.id;
        console.log(`✅ Found existing DB session: ${sessionId}`);
      } else {
        // Create new DB session linked to SDK session
        const result = createChatSession(userId, 'Chat Session', sessionConfig.model, provider, actualSdkSessionId);
        if (result.success) {
          sessionId = result.sessionId;
          console.log(`🆕 Created new DB session ${sessionId} for resumed SDK session`);
        }
      }
    } catch (err) {
      console.log(`⚠️ Failed to resume SDK session: ${err.message}`);
      console.log(`   Creating new SDK session instead...`);
      sdkSessionId = null; // Reset so we create new session below
    }
  }
  
  // If not resuming or resume failed, create new session
  if (!sdkSessionId) {
    // Check for existing active session in database
    const dbSession = getActiveChatSession(userId);
    
    if (dbSession && dbSession.sdk_session_id) {
      // Use the model from the existing DB session
      const sessionModel = dbSession.model || 'llama3.2';
      sessionConfig.model = sessionModel;
      console.log(`🔧 Using model from active session: ${sessionModel}`);
      
      // Try to resume the existing SDK session
      console.log(`📂 Found existing session with SDK ID: ${dbSession.sdk_session_id}`);
      try {
        sdkSession = await copilotClient.resumeSession(dbSession.sdk_session_id, sessionConfig);
        actualSdkSessionId = sdkSession.id || sdkSession.sessionId;
        sessionId = dbSession.id;
        console.log(`✅ Resumed existing SDK session: ${actualSdkSessionId}`);
        
        // Load messages from SDK session
        try {
          const sdkMessages = await sdkSession.getMessages();
          history = sdkMessages.map(msg => ({
            role: msg.data?.role || (msg.type === 'user.message' ? 'user' : 'assistant'),
            content: msg.data?.content || '',
            timestamp: Date.now()
          }));
        } catch (e) {
          // Fall back to DB messages
          history = getRecentChatMessages(sessionId, 50);
        }
      } catch (err) {
        console.log(`⚠️ Could not resume SDK session: ${err.message}`);
        // Create new SDK session
        sdkSession = await copilotClient.createSession(sessionConfig);
        actualSdkSessionId = sdkSession.id || sdkSession.sessionId;
        sessionId = dbSession.id;
        
        // Update DB session with new SDK ID
        updateChatSessionSdkId(sessionId, actualSdkSessionId);
        
        // Load DB messages for history
        history = getRecentChatMessages(sessionId, 50);
      }
    } else if (dbSession) {
      // Existing DB session but no SDK session, create new SDK session
      sessionId = dbSession.id;
      console.log(`📂 Creating new SDK session for existing DB session ${sessionId}`);
      
      // Use the model from the existing DB session
      const sessionModel = dbSession.model || 'llama3.2';
      sessionConfig.model = sessionModel;
      console.log(`🔧 Using model from existing session: ${sessionModel}`);
      
      sdkSession = await copilotClient.createSession(sessionConfig);
      actualSdkSessionId = sdkSession.id || sdkSession.sessionId;
      
      // Update DB session with SDK ID
      updateChatSessionSdkId(sessionId, actualSdkSessionId);
      
      history = getRecentChatMessages(sessionId, 50);
    }else {
      // Create completely new session
      console.log(`🆕 Creating new SDK and DB session for user ${userId}`);
      
      sdkSession = await copilotClient.createSession(sessionConfig);
      actualSdkSessionId = sdkSession.id || sdkSession.sessionId;
      
      const result = createChatSession(userId, 'Chat Session', useModel, provider, actualSdkSessionId);
      if (!result.success) {
        throw new Error('Failed to create chat session in database');
      }
      sessionId = result.sessionId;
    }
  }
  
  console.log(`🔧 Session ready - DB: ${sessionId}, SDK: ${actualSdkSessionId}`);
  
  // Set up comprehensive event handlers
  setupSessionEventHandlers(sdkSession, userId, sessionId);
  
  // Use Map pattern for multi-session support
  let userSessions = chatSessions.get(userId);
  if (!(userSessions instanceof Map)) {
    userSessions = new Map();
    chatSessions.set(userId, userSessions);
  }
  
  const chatSessionData = {
    session: sdkSession,
    sdkSessionId: actualSdkSessionId,
    sessionId,
    history,
    lastActivity: Date.now(),
    currentMode: 'interactive',
    pendingToolCalls: new Map()
  };
  
  userSessions.set(sessionId, chatSessionData);
  
  return { session: sdkSession, sdkSessionId: actualSdkSessionId, sessionId, history };
}

// Set up all event handlers for the session
function setupSessionEventHandlers(session, userId, sessionId) {
  // Prevent duplicate handler registration
  if (session._eventHandlersSetup) {
    return;
  }
  session._eventHandlersSetup = true;

  // Assistant message
  session.on('assistant.message', (event) => {
    const userSessions = chatSessions.get(userId);
    const chatData = userSessions?.get(sessionId);
    if (chatData) {
      const message = {
        role: 'assistant',
        content: event.data.content,
        timestamp: Date.now()
      };
      
      chatData.history.push(message);
      addChatMessage(chatData.sessionId, 'assistant', event.data.content);
      
      broadcastToUser(userId, {
        type: 'chat_message',
        sessionId: sessionId,
        role: 'assistant',
        content: event.data.content
      });
    }
  });
  
  // Streaming message delta (for real-time streaming)
  session.on('assistant.message_delta', (event) => {
    broadcastToUser(userId, {
      type: 'chat_stream_delta',
      delta: event.data.delta || event.data.content || '',
      sessionId: sessionId
    });
  });
  
  // Reasoning events (for extended thinking)
  session.on('assistant.reasoning', (event) => {
    broadcastToUser(userId, {
      type: 'chat_reasoning',
      sessionId: sessionId,
      content: event.data.content || event.data.reasoning || ''
    });
  });
  
  session.on('assistant.reasoning_delta', (event) => {
    broadcastToUser(userId, {
      type: 'chat_reasoning_delta',
      sessionId: sessionId,
      content: event.data.delta || ''
    });
  });
  
  // Tool execution events
  session.on('tool.execution_start', (event) => {
    const userSessions = chatSessions.get(userId);
    const chatData = userSessions?.get(sessionId);
    if (chatData) {
      const toolCallId = event.data.id || `tool_${Date.now()}`;
      chatData.pendingToolCalls.set(toolCallId, {
        name: event.data.name,
        arguments: event.data.arguments || {},
        status: 'running'
      });
      
      broadcastToUser(userId, {
        type: 'tool_start',
        sessionId: sessionId,
        toolId: toolCallId,
        name: event.data.name,
        description: event.data.description || `Running ${event.data.name}...`,
        arguments: event.data.arguments
      });
    }
  });
  
  session.on('tool.execution_progress', (event) => {
    broadcastToUser(userId, {
      type: 'tool_progress',
      sessionId: sessionId,
      toolId: event.data.id,
      progress: event.data.progress || ''
    });
  });
  
  session.on('tool.execution_complete', (event) => {
    const userSessions = chatSessions.get(userId);
    const chatData = userSessions?.get(sessionId);
    if (chatData) {
      chatData.pendingToolCalls.delete(event.data.id);
    }
    
    broadcastToUser(userId, {
      type: 'tool_complete',
      sessionId: sessionId,
      toolId: event.data.id,
      result: event.data.result || '',
      success: !event.data.error
    });
  });
  
  // Permission events
  session.on('permission.requested', (event) => {
    console.log(`Permission requested: ${event.data.kind}`);
  });
  
  session.on('permission.completed', (event) => {
    broadcastToUser(userId, {
      type: 'permission_completed',
      sessionId: sessionId,
      requestId: event.data.requestId,
      result: event.data.result
    });
  });
  
  // Mode changes (interactive, plan, autopilot)
  session.on('mode.changed', (event) => {
    const userSessions = chatSessions.get(userId);
    const chatData = userSessions?.get(sessionId);
    if (chatData) {
      chatData.currentMode = event.data.mode || 'interactive';
    }
    
    broadcastToUser(userId, {
      type: 'mode_changed',
      sessionId: sessionId,
      mode: event.data.mode || 'interactive'
    });
  });
  
  // Plan mode events
  session.on('plan.changed', (event) => {
    broadcastToUser(userId, {
      type: 'plan_update',
      sessionId: sessionId,
      operation: event.data.operation, // 'create', 'update', 'delete'
      content: event.data.content || ''
    });
  });
  
  // Session idle / stream complete
  session.on('session.idle', () => {
    console.log(`Chat session idle for user ${userId}`);
    broadcastToUser(userId, { type: 'chat_stream_complete', sessionId: sessionId });
  });
  
  // Error events
  session.on('error', (event) => {
    console.error(`Session error for user ${userId}:`, event.data);
    broadcastToUser(userId, {
      type: 'chat_error',
      sessionId: sessionId,
      message: event.data.message || 'An error occurred',
      code: event.data.code
    });
  });
  
  // Abort events
  session.on('abort', (event) => {
    broadcastToUser(userId, {
      type: 'chat_aborted',
      reason: event.data.reason || 'Operation aborted'
    });
  });
  
  // Sub-agent events
  session.on('subagent.started', (event) => {
    broadcastToUser(userId, {
      type: 'subagent_started',
      agentId: event.data.agentId,
      agentName: event.data.name || 'Agent'
    });
  });
  
  session.on('subagent.completed', (event) => {
    broadcastToUser(userId, {
      type: 'subagent_completed',
      agentId: event.data.agentId,
      success: event.data.success
    });
  });
}

// Helper to broadcast to all connections for a user
function broadcastToUser(userId, message) {
  for (const [ws, clientData] of clients) {
    if (clientData.userId === userId && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }
}

// Initialize Copilot on startup
initCopilotClient().catch(console.error);

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
      default: terminals.find(t => t.recommended)?.id || (platform() === 'win32' ? 'powershell' : 'bash')
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
  const hasCopilot = !!copilotClient;
  const userSessions = chatSessions.get(req.user.id);
  const hasSession = userSessions instanceof Map && userSessions.size > 0;
  // Get first session for history count, or null if no sessions
  const firstSession = hasSession ? userSessions.values().next().value : null;
  
  // Get actual available models from Ollama
  let modelsList = [];
  let defaultModel = null;
  
  if (process.env.OLLAMA_HOST) {
    try {
      const ollamaModels = await getAvailableOllamaModels();
      modelsList = ollamaModels.map(m => m.name || m.model);
      // Use first available model as default
      if (modelsList.length > 0) {
        defaultModel = modelsList[0];
      }
    } catch (err) {
      console.error('Failed to get Ollama models for status:', err.message);
    }
  }
  
  // Fallback to hardcoded default
  if (!defaultModel) {
    defaultModel = 'llama3.2';
  }
  
  // Debug logging
  console.log('📊 Chat status check:', {
    userId: req.user.id,
    hasCopilot,
    hasSession,
    ollamaHost: process.env.OLLAMA_HOST || 'not set',
    ollamaModel: defaultModel,
    modelsCount: modelsList.length
  });
  
  res.json({
    success: true,
    copilotAvailable: hasCopilot,
    hasSession: hasSession,
    messageCount: firstSession?.history?.length || 0,
    ollamaConfigured: !!process.env.OLLAMA_HOST,
    ollamaHost: process.env.OLLAMA_HOST,
    ollamaModel: defaultModel,
    availableModels: modelsList
  });
});

// Get available LLM models
app.get('/api/chat/models', requireAuth, async (req, res) => {
  try {
    // If Ollama is configured, fetch actual available models
    let models = [];
    
    if (process.env.OLLAMA_HOST) {
      const ollamaModels = await getAvailableOllamaModels();
      if (ollamaModels.length > 0) {
        models = ollamaModels.map(m => ({
          id: m.name || m.model,
          name: (m.name || m.model).charAt(0).toUpperCase() + (m.name || m.model).slice(1).replace(/[-:]/g, ' '),
          type: 'ollama',
          size: m.size
        }));
      }
    }
    
    // Fallback to defaults if no Ollama models found
    if (models.length === 0) {
      models = [
        { id: 'llama3.2', name: 'Llama 3.2', type: 'ollama' },
        { id: 'codellama', name: 'CodeLlama', type: 'ollama' },
        { id: 'mistral', name: 'Mistral', type: 'ollama' }
      ];
    }
    
    res.json({
      success: true,
      models,
      provider: {
        type: 'ollama',
        url: process.env.OLLAMA_HOST || 'http://localhost:11434'
      }
    });
  } catch (err) {
    console.error('Error getting models:', err);
    res.status(500).json({ success: false, message: 'Failed to get models' });
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
    
    // First check Ollama directly if configured
    if (process.env.OLLAMA_HOST) {
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
    
    if (!copilotClient) {
      return res.status(503).json({ 
        success: false, 
        message: 'Copilot client not initialized' 
      });
    }
    
    // Create a test session with the specified model
    const testConfig = {
      onPermissionRequest: approveAll,
      model: model || 'llama3.2'
    };
    
    // Add BYOK provider if configured
    // Note: Ollama's OpenAI-compatible API is at /v1 endpoint
    if (process.env.OLLAMA_HOST) {
      const ollamaBaseUrl = process.env.OLLAMA_HOST.replace(/\/$/, '');
      const openAiCompatibleUrl = ollamaBaseUrl.endsWith('/v1') ? ollamaBaseUrl : `${ollamaBaseUrl}/v1`;
      testConfig.provider = {
        type: 'openai',
        baseUrl: openAiCompatibleUrl,
        apiKey: 'ollama'
      };
    }
    
    console.log(`🔍 Testing Copilot SDK connection with model: ${testConfig.model}`);
    
    // Try to create a session
    const session = await copilotClient.createSession(testConfig);
    
    // Send a simple test message
    try {
      await session.send({ prompt: 'Hi' });
      console.log('✅ Copilot SDK connection test successful');
    } catch (sendErr) {
      console.log('⚠️ Test message send error:', sendErr.message);
      // Even if send fails, session creation succeeded
    }
    
    // Disconnect the test session
    try {
      await session.disconnect();
    } catch (e) {}
    
    res.json({
      success: true,
      message: 'Connection successful',
      model: testConfig.model,
      provider: process.env.OLLAMA_HOST ? 'byok' : 'github'
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
          await sessionData.session.disconnect();
        } catch (e) {}
      }
      userSessions.clear();
    }
    
    const { model } = req.body;
    const { session, sessionId, history } = await initCopilotChatSession(req.user.id, model);
    
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
    
    // Send to Copilot
    await chatData.session.send({ prompt: message });
    
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
        await sessionData.session.disconnect();
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
    const sessions = dbSessions.map(dbSession => {
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
      
      // Get recent messages for this session
      const messages = getRecentChatMessages(dbSession.id, 50);
      
      return {
        serverSessionId: dbSession.id,
        clientSessionId: clientSessionId,
        name: dbSession.session_name,
        model: dbSession.model,
        provider: dbSession.provider,
        sdkSessionId: dbSession.sdk_session_id,
        workingDirectory: dbSession.working_directory,
        summary: dbSession.summary,
        createdAt: dbSession.created_at,
        lastActivity: dbSession.last_activity,
        isActive: isActive,
        messageCount: dbSession.message_count,
        messages: messages
      };
    });
    
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
        sdkSessionId: dbSession.sdk_session_id,
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
    
    if (!copilotClient) {
      const initialized = await initCopilotClient();
      if (!initialized) {
        return res.status(503).json({ 
          success: false, 
          message: 'Failed to initialize Copilot client'
        });
      }
    }
    
    // Close existing active sessions
    const existing = chatSessions.get(req.user.id);
    if (existing instanceof Map) {
      for (const [sessionId, sessionData] of existing) {
        try {
          await sessionData.session.disconnect();
        } catch (e) {}
      }
    }
    
    // Resume the session (use SDK session ID if available)
    const useModel = model || dbSession.model || 'llama3.2';
    const sdkSessionId = dbSession.sdk_session_id;
    
    console.log(`📂 Resuming session ${sessionId} with SDK ID: ${sdkSessionId}`);
    
    const result = await initCopilotChatSession(req.user.id, useModel, sdkSessionId);
    
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
          const selectedShellId = message.shell || (platform() === 'win32' ? 'powershell' : 'bash');
          const availableTerminals = getAvailableTerminals();
          shellConfig = availableTerminals.find(t => t.id === selectedShellId);
          
          // Fallback to default if selected shell not found
          if (!shellConfig) {
            shellConfig = availableTerminals.find(t => t.recommended) || availableTerminals[0] || {
              id: platform() === 'win32' ? 'powershell' : 'bash',
              command: platform() === 'win32' ? 'powershell.exe' : 'bash',
              args: []
            };
          }
          
          // Check if terminal already exists (from previous session)
          const existingTerm = terminals.get(terminalKey);
          if (existingTerm?.pty) {
            // Reconnect to existing terminal
            existingTerm.ws = ws;
            existingTerm.lastActivity = Date.now();
            
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
            const ptyProcess = pty.spawn(shellConfig.command, shellConfig.args || [], {
              name: 'xterm-color',
              cols: message.cols || 80,
              rows: message.rows || 24,
              cwd: cwd,
              env: process.env,
              useConpty: true  // Use modern ConPTY API on Windows 10+ (no visible window)
            });
            
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
          const browsePath = message.path || WORKSPACE_DIR;
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
          
          if (!CopilotClient) {
            console.log('❌ chat_session_create failed: Copilot SDK not installed');
            ws.send(JSON.stringify({
              type: 'chat_error',
              message: 'Copilot SDK not installed'
            }));
            return;
          }
          
          (async () => {
            try {
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
              
              const clientSessionId = message.sessionId || `session_${Date.now()}`;
              const sessionName = message.name || 'New Chat';
              
              // Resolve model: prefer client choice, then first available Ollama model, then hardcoded fallback
              let model = message.model;
              let availableOllamaModels = [];
              if (process.env.OLLAMA_HOST) {
                availableOllamaModels = await getAvailableOllamaModels();
              }
              if (!model && availableOllamaModels.length > 0) {
                model = availableOllamaModels[0].name || availableOllamaModels[0].model;
              }
              model = model || 'llama3.2';
              
              console.log(`🔧 Creating session: ${sessionName} (${clientSessionId}) with model: ${model}`);
              
              // Pre-check: Validate model is available in Ollama
              if (process.env.OLLAMA_HOST) {
                const modelIds = availableOllamaModels.map(m => m.name || m.model);
                
                if (!modelIds.includes(model)) {
                  console.error(`❌ Model "${model}" is not available in Ollama`);
                  console.error('📋 Available models:', modelIds.join(', ') || 'None found');
                  ws.send(JSON.stringify({
                    type: 'chat_error',
                    message: `Model "${model}" is not available in Ollama. Available models: ${modelIds.join(', ') || 'None found'}. Run "ollama pull ${model}" to download it, or select a different model.`
                  }));
                  return;
                }
              }
              
              // Create session in database
              const dbResult = createChatSession(clientData.userId, sessionName, model, 'ollama', null, message.workingDirectory || null);
              
              if (!dbResult.success) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Failed to create chat session in database'
                }));
                return;
              }
              
              // Normalize model name for Ollama (add :latest if no tag specified)
              const normalizedModel = model.includes(':') ? model : `${model}:latest`;
              
              // Get working directory from message or use default
              const workingDirectory = message.workingDirectory || WORKSPACE_DIR;
              
              // Create Copilot SDK session
              const sessionConfig = {
                onPermissionRequest: approveAll,
                model: normalizedModel,
              };
              
              // Add BYOK provider if Ollama is configured
              // Note: Ollama's OpenAI-compatible API is at /v1 endpoint
              if (process.env.OLLAMA_HOST) {
                const ollamaBaseUrl = process.env.OLLAMA_HOST.replace(/\/$/, ''); // Remove trailing slash
                const openAiCompatibleUrl = ollamaBaseUrl.endsWith('/v1') ? ollamaBaseUrl : `${ollamaBaseUrl}/v1`;
                sessionConfig.provider = {
                  type: 'openai',
                  baseUrl: openAiCompatibleUrl,
                  apiKey: 'ollama', // Ollama requires any non-empty API key
                  wireApi: 'completions'
                };
                console.log(`🔧 Creating SDK session with BYOK provider:`);
                console.log(`   - Original Model: ${model}`);
                console.log(`   - Normalized Model: ${normalizedModel}`);
                console.log(`   - Base URL: ${openAiCompatibleUrl}`);
                console.log(`   - Wire API: completions`);
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
                // Add timeout to session creation
                const sessionPromise = copilotClient.createSession(sessionConfig);
                const timeoutPromise = new Promise((_, reject) => {
                  setTimeout(() => reject(new Error('Session creation timeout (30s)')), 30000);
                });
                sdkSession = await Promise.race([sessionPromise, timeoutPromise]);
                console.log('✅ SDK session created successfully');
              } catch (sessionErr) {
                console.error('❌ Failed to create Copilot SDK session:', sessionErr.message);
                console.error('Full error:', sessionErr);
                console.error('Session config used:', JSON.stringify({
                  ...sessionConfig,
                  onPermissionRequest: '[Function]'
                }, null, 2));
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: `Failed to create chat session: ${sessionErr.message}. Check your BYOK configuration.`
                }));
                return;
              }
              
              // Extract SDK session ID
              const sdkSessionId = sdkSession.id || sdkSession.sessionId;
              
              // Persist SDK session ID to database for future reconnection
              if (sdkSessionId && dbResult?.sessionId) {
                updateChatSessionSdkId(dbResult.sessionId, sdkSessionId);
                console.log(`💾 Saved SDK session ID to database: ${sdkSessionId}`);
              }
              
              // Store session mapping (consistent with initCopilotChatSession structure)
              const chatSessionData = {
                clientSessionId: clientSessionId,
                sessionId: dbResult.sessionId,
                sdkSessionId: sdkSessionId,
                session: sdkSession,
                name: sessionName,
                model: model,
                workingDirectory: workingDirectory, // Store for later use
                history: [],
                lastActivity: Date.now(),
                currentMode: 'interactive',
                pendingToolCalls: new Map()
              };
              
              // Set up message handlers for this session (following SDK documentation)
              console.log('📡 Setting up SDK session event handlers...');
              
              sdkSession.on('assistant.message', (event) => {
                console.log('📨 SDK event: assistant.message', event.data?.content?.substring(0, 50));
                const assistantMsg = {
                  role: 'assistant',
                  content: event.data.content,
                  timestamp: Date.now()
                };
                // Update in-memory history
                chatSessionData.history.push(assistantMsg);
                // Persist to database
                addChatMessage(dbResult.sessionId, 'assistant', event.data.content);
                
                // Broadcast to all connections for this user
                for (const [clientWs, clientDataItem] of clients) {
                  if (clientDataItem.userId === clientData.userId && clientWs.readyState === 1) {
                    clientWs.send(JSON.stringify({
                      type: 'chat_message',
                      sessionId: dbResult.sessionId,
                      role: 'assistant',
                      content: event.data.content
                    }));
                  }
                }
              });
              
              // Handle streaming message deltas (for real-time responses)
              sdkSession.on('assistant.message_delta', (event) => {
                console.log('📨 SDK event: assistant.message_delta', event.data?.deltaContent?.substring(0, 30));
                for (const [clientWs, clientDataItem] of clients) {
                  if (clientDataItem.userId === clientData.userId && clientWs.readyState === 1) {
                    clientWs.send(JSON.stringify({
                      type: 'chat_stream_delta',
                      sessionId: dbResult.sessionId,
                      delta: event.data.deltaContent || event.data.delta || event.data.content || ''
                    }));
                  }
                }
              });
              
              // Handle session idle (response complete)
              sdkSession.on('session.idle', (event) => {
                console.log('📨 SDK event: session.idle - Response complete');
                // Notify client that response is complete
                for (const [clientWs, clientDataItem] of clients) {
                  if (clientDataItem.userId === clientData.userId && clientWs.readyState === 1) {
                    clientWs.send(JSON.stringify({
                      type: 'chat_stream_complete',
                      sessionId: dbResult.sessionId
                    }));
                  }
                }
              });
              
              // Handle session errors
              sdkSession.on('session.error', (event) => {
                console.error('📨 SDK event: session.error', event.data);
                for (const [clientWs, clientDataItem] of clients) {
                  if (clientDataItem.userId === clientData.userId && clientWs.readyState === 1) {
                    clientWs.send(JSON.stringify({
                      type: 'chat_error',
                      sessionId: dbResult.sessionId,
                      message: event.data?.message || 'Session error occurred'
                    }));
                  }
                }
              });
              
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
                name: sessionName,
                model: model,
                workingDirectory: workingDirectory,
                history: []
              }));
              
              console.log(`✅ Chat session created: ${sessionName} (${clientSessionId})`);
            } catch (err) {
              console.error('Chat session creation error:', err);
              ws.send(JSON.stringify({
                type: 'chat_error',
                message: err.message
              }));
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
                  
                  // Disconnect SDK session
                  try {
                    await sessionData.session.disconnect();
                    console.log(`🔌 Disconnected SDK session: ${sdkSessionId}`);
                  } catch (e) {
                    console.log(`⚠️ Error disconnecting SDK session: ${e.message}`);
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
              
              const clientSessionId = message.sessionId;
              const serverSessionId = message.serverSessionId;
              let sdkSessionId = message.sdkSessionId; // SDK session ID from client
              const sessionName = message.name || 'Chat Session';
              const model = message.model || 'llama3.2';
              
              // Resolve working directory: message > database > default
              let workingDirectory = message.workingDirectory;
              if (!workingDirectory && serverSessionId) {
                const dbSession = getChatSessionById(serverSessionId, clientData.userId);
                if (dbSession?.working_directory) {
                  workingDirectory = dbSession.working_directory;
                }
              }
              if (!workingDirectory) {
                workingDirectory = WORKSPACE_DIR;
              }
              
              // Check if session already exists in memory
              const userSessions = chatSessions.get(clientData.userId);
              if (userSessions instanceof Map && userSessions.has(clientSessionId)) {
                // Already connected - just confirm, but fetch latest history from DB to ensure completeness
                const existingSession = userSessions.get(clientSessionId);
                const existingMessages = getRecentChatMessages(existingSession.sessionId, 100);
                ws.send(JSON.stringify({
                  type: 'chat_session_created',
                  success: true,
                  clientSessionId: clientSessionId,
                  serverSessionId: existingSession.sessionId,
                  sdkSessionId: existingSession.sdkSessionId,
                  name: existingSession.name,
                  model: existingSession.model,
                  workingDirectory: existingSession.workingDirectory,
                  history: existingMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })) || []
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
              
              const result = await initCopilotChatSession(clientData.userId, model, sdkSessionId);
              
              if (!result || !result.session) {
                throw new Error('Failed to initialize Copilot chat session');
              }
              
              // Update the database session with the new SDK session ID if it changed
              if (result.sdkSessionId && result.sdkSessionId !== sdkSessionId) {
                updateChatSessionSdkId(serverSessionId, result.sdkSessionId);
              }
              
              // Get existing messages from database for client history
              const existingMessages = getRecentChatMessages(serverSessionId, 100);
              
              // Update the session data stored by initCopilotChatSession with client-specific info
              const userSessionStore = chatSessions.get(clientData.userId);
              const chatSessionData = userSessionStore?.get(clientSessionId) || {
                session: result.session,
                sdkSessionId: result.sdkSessionId,
                sessionId: serverSessionId,
                history: [],
                lastActivity: Date.now(),
                currentMode: 'interactive',
                pendingToolCalls: new Map()
              };
              
              // Add client-specific properties
              chatSessionData.clientSessionId = clientSessionId;
              chatSessionData.name = sessionName;
              chatSessionData.model = model;
              chatSessionData.workingDirectory = workingDirectory;
              
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
                name: sessionName,
                model: model,
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
            try {
              const userSessions = chatSessions.get(clientData.userId);
              const sessionId = message.sessionId;
              
              if (!(userSessions instanceof Map) || !sessionId) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Chat session not found'
                }));
                return;
              }
              
              let sessionData = userSessions.get(sessionId);
              
              if (!sessionData) {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  message: 'Chat session not initialized'
                }));
                return;
              }
              
              // Add user message to history
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
              
              // Send to Copilot SDK
              await sessionData.session.send({ prompt: promptText });
            } catch (err) {
              ws.send(JSON.stringify({
                type: 'chat_error',
                sessionId: message.sessionId,
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
                  await sessionData.session.disconnect();
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
                pending.resolve({ kind: 'approved' });
              } else {
                pending.reject(new Error('Permission denied by user'));
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
            } else {
              console.warn(`No pending user input request found: ${requestId}`);
            }
          })();
          break;
          
        case 'chat_command':
          // Handle slash commands like /plan, /agent, /allow-all
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
            
            if (!sessionData?.session) {
              ws.send(JSON.stringify({ type: 'chat_error', message: 'No SDK session available' }));
              return;
            }
            
            try {
              const sdkSession = sessionData.session;
              let result = { success: true };
              
              switch (command) {
                case '/allow-all':
                  // Enable all permissions automatically for this session
                  sessionData.autoApprove = true;
                  result.message = 'All permissions will be automatically approved';
                  break;
                  
                case '/ask-permissions':
                  // Ask for permission for each action
                  sessionData.autoApprove = false;
                  result.message = 'Permissions will be requested before each action';
                  break;
                  
                case '/plan':
                  // Enter plan mode - the agent creates a plan before executing
                  sessionData.currentMode = 'plan';
                  result.message = 'Entered plan mode. The agent will create a plan before executing.';
                  result.mode = 'plan';
                  break;
                  
                case '/interactive':
                  // Exit plan mode, return to interactive mode
                  sessionData.currentMode = 'interactive';
                  result.message = 'Returned to interactive mode';
                  result.mode = 'interactive';
                  break;
                  
                case '/autopilot':
                  // Enter autopilot mode - agent continues autonomously
                  sessionData.currentMode = 'autopilot';
                  result.message = 'Entered autopilot mode. The agent will continue working autonomously.';
                  result.mode = 'autopilot';
                  break;
                  
                case '/interrupt':
                case '/stop':
                  // Interrupt current operation
                  try {
                    await sdkSession.interrupt();
                    result.message = 'Operation interrupted';
                  } catch (e) {
                    result.message = `Interrupt failed: ${e.message}`;
                    result.success = false;
                  }
                  break;
                  
                case '/resume':
                  // Get session info for resuming later
                  result.message = `Session ID: ${sessionData.sdkSessionId}`;
                  result.sessionId = sessionData.sdkSessionId;
                  break;
                  
                default:
                  result.success = false;
                  result.message = `Unknown command: ${command}. Available commands: /allow-all, /ask-permissions, /plan, /interactive, /autopilot, /interrupt, /resume`;
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
            
            const sessionData = Array.from(userSessions.values())[0];
            if (sessionData?.session) {
              try {
                await sessionData.session.interrupt();
                ws.send(JSON.stringify({ type: 'interrupt_success' }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'chat_error', message: err.message }));
              }
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
              model: sessionData?.model || 'llama3.2',
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
    
    // Mark terminals for this user as disconnected (keep them alive for grace period)
    if (clientData?.userId) {
      for (const [key, t] of terminals) {
        if (t.userId === clientData.userId) {
          t.ws = null; // Mark as disconnected
          t.disconnectedAt = Date.now();
          console.log(`Terminal ${t.terminalId} marked for cleanup (user ${clientData.userId})`);
        }
      }
    }
    
    clients.delete(ws);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║      Terminal Web UI Server Started        ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  URL:     http://${HOST}:${PORT}                     ║`);
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Workspace: ${WORKSPACE_DIR}`);
  console.log('║  Auth: Required (see default credentials)  ║');
  console.log('╚════════════════════════════════════════════╝');
});

// Cleanup orphaned terminals and chat sessions periodically
setInterval(() => {
  const now = Date.now();
  
  // Cleanup terminals
  for (const [key, t] of terminals) {
    if (t.ws === null && t.disconnectedAt) {
      if (now - t.disconnectedAt > TERM_GRACE_PERIOD) {
        console.log(`Cleaning up orphaned terminal ${key}`);
        try { t.pty.kill(); } catch (e) {}
        terminals.delete(key);
      }
    }
  }
  
  // Cleanup chat sessions
  for (const [userId, userSessions] of chatSessions) {
    let hasActive = false;
    for (const [sessionId, chatData] of userSessions) {
      if (now - chatData.lastActivity > CHAT_GRACE_PERIOD) {
        console.log(`Cleaning up expired chat session ${sessionId} for user ${userId}`);
        try {
          chatData.session.disconnect();
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
        await chatData.session.disconnect();
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



