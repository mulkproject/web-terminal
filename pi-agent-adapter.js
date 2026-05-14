/**
 * PI Agent SDK Adapter
 * Uses @earendil-works/pi-coding-agent's native JS SDK instead of subprocess RPC.
 * Each user session maps to one AgentSession with event subscriptions.
 */

import { createRequire } from 'module';
import { existsSync, mkdirSync } from 'fs';
import { platform } from 'os';
import { execSync } from 'child_process';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const PI_SESSION_DIR = process.env.PI_SESSION_DIR || (WORKSPACE_DIR + (platform() === 'win32' ? '\\' : '/') + 'pi-agent-sessions');

// ── Dynamic SDK import: local first, then global fallback ──────────
let PiSdk = null;

function getNpmGlobalPath() {
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (globalRoot && existsSync(globalRoot)) {
      return globalRoot;
    }
  } catch (e) {
    // npm not available or command failed
  }
  // Platform-specific fallback guesses
  if (platform() === 'win32') {
    const appData = process.env.APPDATA || (process.env.USERPROFILE + '\\AppData\\Roaming');
    return appData + '\\npm\\node_modules';
  }
  return '/usr/local/lib/node_modules';
}

async function resolveSdk() {
  if (PiSdk) return PiSdk;

  // 1. Try local node_modules (standard Node.js resolution)
  try {
    PiSdk = await import('@earendil-works/pi-coding-agent');
    log('✅ Loaded PI SDK from local node_modules');
    return PiSdk;
  } catch (e) {
    log('⚠️ Local SDK not found, trying global path...');
  }

  // 2. Try global npm install via detected path
  const globalRoot = getNpmGlobalPath();
  const globalPaths = [
    `file://${globalRoot}/@earendil-works/pi-coding-agent/dist/index.js`,
  ];

  // 3. Also try createRequire-based resolution from global root
  try {
    const requireFromGlobal = createRequire(globalRoot + '/package.json');
    const resolved = requireFromGlobal.resolve('@earendil-works/pi-coding-agent');
    if (resolved) {
      PiSdk = await import(resolved);
      log('✅ Loaded PI SDK from global install (createRequire)');
      return PiSdk;
    }
  } catch (e) {
    log('⚠️ createRequire global resolution failed:', e.message);
  }

  // 4. Direct file URL attempts
  for (const globalPath of globalPaths) {
    try {
      PiSdk = await import(globalPath);
      log('✅ Loaded PI SDK from global install');
      return PiSdk;
    } catch (e2) {
      log('⚠️ Global path failed:', globalPath, e2.message);
    }
  }

  throw new Error(
    'PI SDK not available. Install with:\n' +
    '  npm install @earendil-works/pi-coding-agent       (local)\n' +
    '  npm install -g @earendil-works/pi-coding-agent    (global)\n' +
    `Detected global path: ${globalRoot}`
  );
}

// ── Session store: clientSessionId → { session, entry, callbacks } ─
const piSessions = new Map();

function log(...args) {
  console.log('[PI-Agent]', ...args);
}

// ── buildProviderConfig ─────────────────────────────────────────────
function buildProviderConfig() {
  const provider = process.env.LLM_PROVIDER || 'ollama';
  if (provider === 'nvidia') {
    return {
      provider: 'nvidia',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: process.env.NVIDIA_API_KEY || '',
      noBuiltinTools: true
    };
  }
  // Ollama — wire API is openai-compatible but provider name is 'ollama'
  // Store the base Ollama URL (without /v1) for API calls
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  return {
    provider: 'ollama',
    baseUrl: ollamaHost.endsWith('/v1') ? ollamaHost : `${ollamaHost}/v1`,
    apiKey: process.env.OLLAMA_API_KEY || 'ollama',
    ollamaHost: ollamaHost.replace(/\/$/, ''), // Store raw host for Ollama API
    noBuiltinTools: false
  };
}

// ── fetchAvailableOllamaModels ─────────────────────────────────────
// Fetches the list of models actually pulled in local Ollama instance
async function fetchAvailableOllamaModels(ollamaHost) {
  try {
    const baseUrl = ollamaHost || 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama API returned ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    // Ollama returns { models: [{ name: 'llama3.2:latest', ... }, ...] }
    const models = data.models || [];
    return models.map(m => m.name).filter(Boolean);
  } catch (err) {
    log('⚠️ Failed to fetch Ollama models:', err.message);
    return null;
  }
}

// ── validateOllamaModel ─────────────────────────────────────────────
// Validates that the requested model is available in local Ollama
async function validateOllamaModel(modelName, ollamaHost) {
  const availableModels = await fetchAvailableOllamaModels(ollamaHost);
  
  if (!availableModels) {
    throw new Error(
      'Could not connect to Ollama to verify available models. ' +
      'Make sure Ollama is running on your machine.'
    );
  }
  
  if (availableModels.length === 0) {
    throw new Error(
      'No Ollama models found. Please pull a model first:\n' +
      '  ollama pull llama3.2:latest\n' +
      'Then run: ollama list'
    );
  }
  
  // Normalize the requested model name (add :latest if no tag)
  const normalizedRequested = modelName.includes(':') ? modelName : `${modelName}:latest`;
  
  // Check exact match first, then check without tag
  if (availableModels.includes(normalizedRequested)) {
    return normalizedRequested; // Valid, return normalized name
  }
  
  // Check if base name matches (e.g., "llama3.2" matches "llama3.2:latest" or "llama3.2:8b")
  const matchingModel = availableModels.find(m => {
    const baseName = m.split(':')[0];
    return baseName === modelName || m === modelName;
  });
  
  if (matchingModel) {
    return matchingModel; // Return the exact name from Ollama
  }
  
  // Model not found - throw error with helpful message
  const availableList = availableModels.slice(0, 10).join(', ');
  throw new Error(
    `Model "${modelName}" is not available in your local Ollama.\n` +
    `Available models: ${availableList}${availableModels.length > 10 ? ` (+${availableModels.length - 10} more)` : ''}\n\n` +
    `To use this model, pull it first:\n` +
    `  ollama pull ${modelName}:latest`
  );
}

// ── Event translation: SDK event → websocket-compatible payload ──
function translateEvent(event) {
  if (!event?.type) return null;

  // FILTER: Only translate assistant messages. User message_start / message_update / message_end
  // are emitted by the SDK too, but we already track user messages in the server/database.
  // Translating user events causes them to be echoed back as assistant responses.
  const role = event.message?.role;
  if (role === 'user') return null;

  switch (event.type) {
    case 'message_start': {
      // Assistant message is starting — signal the beginning of streaming
      if (role === 'assistant') {
        return { type: 'agent_event', subtype: 'message_start' };
      }
      return null;
    }
    case 'message_update': {
      // Streaming assistant output. The actual text delta is in assistantMessageEvent,
      // NOT in message.content (which is only populated at message_end).
      if (role === 'assistant' && event.assistantMessageEvent) {
        const ame = event.assistantMessageEvent;
        if (ame.type === 'text_delta' && ame.delta) {
          return { type: 'agent_event', subtype: 'text_delta', delta: ame.delta };
        }
        if (ame.type === 'thinking_delta' && ame.delta) {
          return { type: 'agent_event', subtype: 'thinking_delta', delta: ame.delta };
        }
      }
      return null;
    }
    case 'message_end': {
      // Final assistant message — extract text from message.content
      if (role === 'assistant') {
        let text = '';
        let toolCalls = [];
        if (Array.isArray(event.message?.content)) {
          for (const c of event.message.content) {
            if (c.type === 'text' && c.text) text += c.text;
            else if (c.type === 'toolCall') toolCalls.push(c.toolCall?.name || c.name || 'unknown');
          }
        } else if (typeof event.message?.content === 'string') {
          text = event.message.content;
        }
        // If the model produced any text, always deliver it regardless of stopReason.
        // Only report an error when there's genuinely no content and stopReason is 'error'.
        if (text.trim().length > 0) {
          return { type: 'agent_event', subtype: 'message_end', message: event.message, fullText: text };
        }
        if (event.message?.stopReason === 'error') {
          // Provide more detailed error info if available
          const errorDetail = event.error || event.message?.error || 'Unknown error';
          log('❌ Model error occurred:', errorDetail, 'Model:', event.message?.model || 'unknown');
          return { type: 'agent_event', subtype: 'extension_error', error: `The model returned an error: ${errorDetail}. Check that Ollama is running and the model is pulled (e.g., run: ollama pull llama3.2:latest).` };
        }
        // Empty but not an error — deliver empty message_end so UI doesn't hang
        return { type: 'agent_event', subtype: 'message_end', message: event.message, fullText: '' };
      }
      return null;
    }
    case 'tool_execution_start':
      return { type: 'agent_event', subtype: 'tool_execution_start', toolName: event.toolName, toolCallId: event.toolCallId, args: event.args };
    case 'tool_execution_end':
      return { type: 'agent_event', subtype: 'tool_execution_end', toolCallId: event.toolCallId, result: event.result, isError: event.isError };
    case 'agent_start':
      return { type: 'agent_event', subtype: 'agent_start' };
    case 'agent_end':
      return { type: 'agent_event', subtype: 'agent_end' };
    case 'turn_start':
      return { type: 'agent_event', subtype: 'turn_start' };
    case 'turn_end': {
      let text = '';
      if (Array.isArray(event.message?.content)) {
        text = event.message.content
          .filter(c => c.type === 'text')
          .map(c => c.text || '')
          .join('');
      } else if (typeof event.message?.content === 'string') {
        text = event.message.content;
      }
      return { type: 'agent_event', subtype: 'turn_end', message: event.message, toolResults: event.toolResults, fullText: text };
    }
    case 'extension_ui_request':
      return { type: 'agent_event', subtype: 'extension_ui_request', payload: event };
    case 'extension_error':
      return { type: 'agent_event', subtype: 'extension_error', error: event.error };
    default:
      return null;
  }
}

// ── createPiSession ─────────────────────────────────────────────────
export async function createPiSession(clientSessionId, sessionName, model, workingDirectory, providerConfig = null) {
  if (!existsSync(PI_SESSION_DIR)) {
    try { mkdirSync(PI_SESSION_DIR, { recursive: true }); } catch (e) { log('⚠️ Failed to create session dir:', e.message); }
  }
  const safeWorkingDirectory = workingDirectory || WORKSPACE_DIR;
  if (!existsSync(safeWorkingDirectory)) {
    try { mkdirSync(safeWorkingDirectory, { recursive: true }); } catch (e) { log('⚠️ Failed to create working dir:', e.message); }
  }

  const sdk = await resolveSdk();

  const config = providerConfig || buildProviderConfig();
  
  // SANITIZE: If using Ollama, ensure we have a valid Ollama model, not an SDK registry model.
  // Also validate that the model is actually pulled and available locally via 'ollama list'.
  let sanitizedModel = model;
  if (config.provider === 'ollama') {
    // Known SDK registry model patterns that are NOT valid Ollama models
    const invalidOllamaModels = ['minimax', 'gpt-', 'claude-', 'gemini-'];
    const isSdkRegistryModel = invalidOllamaModels.some(pattern => 
      model?.toLowerCase().includes(pattern)
    );
    
    if (!model || isSdkRegistryModel) {
      log('⚠️ Detected SDK registry model "' + model + '", will validate against local Ollama...');
    }
    
    try {
      // Validate against actual Ollama local models
      const validatedModel = await validateOllamaModel(model || 'llama3.2', config.ollamaHost);
      sanitizedModel = validatedModel;
      log('✅ Validated Ollama model:', sanitizedModel, '(from local ollama list)');
    } catch (err) {
      // Re-throw with clear error message
      throw new Error(err.message);
    }
  }
  const authStorage = sdk.AuthStorage.create();
  const modelRegistry = sdk.ModelRegistry.create(authStorage);

  // Detect NVIDIA NIM: server.js passes provider='openai' for NVIDIA too,
  // so we detect by baseUrl containing nvidia.com
  const isNvidia = config.provider === 'nvidia' || (config.baseUrl && config.baseUrl.includes('nvidia.com'));

  // NVIDIA NIM uses OpenAI-compatible API, so we must register the key under 'openai'
  // for the SDK's auth system to recognize it.
  if (config.apiKey) {
    if (isNvidia) {
      authStorage.setRuntimeApiKey('openai', config.apiKey);
      log('🔑 Registered NVIDIA API key as OpenAI provider key');
    } else {
      authStorage.setRuntimeApiKey(config.provider, config.apiKey);
    }
  }

  // Resolve model.
  // For Ollama, we create a custom model object rather than relying on SDK registry templates,
  // because the SDK registry contains models like 'minimax-m2.7:cloud' that don't exist locally.
  let sdkModel = null;

  if (sanitizedModel) {
    // For Ollama, create a minimal custom model that works with the SDK's createAgentSession
    if (config.provider === 'ollama') {
      // Model name is already normalized by validateOllamaModel
      const normalizedModel = sanitizedModel;
      log('🔧 Using validated Ollama model:', normalizedModel);
      if (!sanitizedModel.includes(':')) {
        log('🔧 Normalized Ollama model name:', sanitizedModel, '→', normalizedModel);
      }
      
      // Create a minimal Ollama-compatible model object
      // We try to find a template first for SDK compatibility, but mutate it heavily
      const template = modelRegistry.getAvailable().find(m => m.provider === 'ollama') || modelRegistry.getAvailable()[0];
      
      if (!template) {
        throw new Error('No available template models found. The SDK could not load any models from its registry. Check installation.');
      }
      
      // Create a copy and mutate it for our Ollama model
      sdkModel = { ...template };
      sdkModel.id = normalizedModel;
      sdkModel.name = normalizedModel;
      sdkModel.baseUrl = config.baseUrl;
      sdkModel.api = 'openai-completions';
      sdkModel.provider = 'ollama';
      sdkModel._isOllamaCustom = true; // Mark as custom Ollama model
      
      log('🔧 Created Ollama model config:', sdkModel.id, 'provider:', sdkModel.provider, 'baseUrl:', sdkModel.baseUrl);
    } else {
      // For NVIDIA and other providers, use the registry template approach
      const template = modelRegistry.find(config.provider, sanitizedModel)
        || modelRegistry.getAvailable().find(m => m.provider === config.provider)
        || modelRegistry.getAvailable()[0];

      if (!template) {
        throw new Error('No available template models found. The SDK could not load any models from its registry. Check installation.');
      }

      template.id = sanitizedModel;
      template.name = sanitizedModel;
      template.baseUrl = config.baseUrl || template.baseUrl;
      template.api = 'openai-completions';
      template.provider = 'openai'; // NVIDIA uses OpenAI-compatible API
      
      sdkModel = template;
      log('🔧 Mutated template model:', sdkModel.id, 'provider:', sdkModel.provider, 'baseUrl:', sdkModel.baseUrl);
    }
  } else {
    // No model specified — fall back to first available from registry
    const available = await modelRegistry.getAvailable();
    sdkModel = available.find(m => m.provider === config.provider) || available[0];
    if (sdkModel) log('✅ Fallback to registry model:', sdkModel.id);
  }

  if (!sdkModel) {
    throw new Error('No available LLM model found. Check provider API key and model configuration.');
  }

  const settingsManager = sdk.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  // Use a PERSISTENT session manager so conversation history survives
  // reconnects, tab switches, and server restarts. The SDK saves messages
  // to a .jsonl file under PI_SESSION_DIR.
  const sessionManager = sdk.SessionManager.create(PI_SESSION_DIR);

  // Let the SDK auto-create coding tools for the working directory.
  const { session, extensionsResult } = await sdk.createAgentSession({
    cwd: safeWorkingDirectory,
    model: sdkModel,
    thinkingLevel: 'off',
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
  });

  const entry = {
    session,
    sessionFile: session.sessionFile,
    piSessionId: session.sessionId,
    onMessage: null,
    onError: null,
    initialized: true,
    _sending: false,
    _sendingTimeout: null,
    textAccumulator: '',
  };

  session.subscribe((event) => {
    const translated = translateEvent(event);
    if (!translated) return;

    switch (translated.subtype) {
      case 'text_delta': {
        const delta = translated.delta || '';
        if (delta) {
          entry.textAccumulator += delta;
          entry.onMessage?.('agent_event', {
            type: 'message_update',
            message: { content: [{ type: 'text', text: delta }] }
          });
        }
        break;
      }
      case 'thinking_delta': {
        // Optionally stream thinking/reasoning text
        const delta = translated.delta || '';
        if (delta) {
          entry.onMessage?.('agent_event', {
            type: 'message_update',
            message: { content: [{ type: 'thinking', thinking: delta }] }
          });
        }
        break;
      }
      case 'message_start': {
        // Reset accumulator for a new assistant message
        entry.textAccumulator = '';
        entry.onMessage?.('agent_event', { type: 'message_start' });
        break;
      }
      case 'message_end': {
        const fullText = translated.fullText || '';
        entry.textAccumulator = '';
        entry.onMessage?.('agent_event', {
          type: 'message_end',
          message: { content: [{ type: 'text', text: fullText }] }
        });
        break;
      }
      case 'tool_execution_start': {
        entry.onMessage?.('agent_event', {
          type: 'tool_execution_start',
          toolCallId: translated.toolCallId,
          toolName: translated.toolName,
          args: translated.args
        });
        break;
      }
      case 'tool_execution_end': {
        entry.onMessage?.('agent_event', {
          type: 'tool_execution_end',
          toolCallId: translated.toolCallId,
          result: translated.result,
          isError: translated.isError
        });
        break;
      }
      case 'agent_start':
      case 'turn_start': {
        // Reset text tracking for a new turn
        entry.lastTextLength = 0;
        entry.textAccumulator = '';
        entry.onMessage?.('agent_event', { type: 'agent_start' });
        break;
      }
      case 'agent_end':
      case 'turn_end': {
        entry.lastTextLength = 0;
        entry.onMessage?.('agent_event', { type: 'agent_end' });
        break;
      }
      case 'extension_ui_request': {
        entry.onMessage?.('extension_ui_request', translated.payload);
        break;
      }
      case 'extension_error': {
        entry.onError?.(`Extension error: ${translated.error}`);
        break;
      }
    }
  });

  piSessions.set(clientSessionId, entry);
  log(`✅ PI SDK session created: ${clientSessionId} → PI session ${session.sessionId}`);
  return entry;
}

// ── restorePiSession ───────────────────────────────────────────────
export async function restorePiSession(clientSessionId, sessionName, model, workingDirectory, sessionFilePath, providerConfig = null) {
  if (!sessionFilePath) {
    throw new Error('No sessionFilePath provided for restore');
  }
  log(`🔄 Restoring PI session ${clientSessionId} from ${sessionFilePath}`);

  // For now, create fresh and rely on session manager/switch if needed
  // Full SDK runtime with switchSession will be done if sessionFile exists
  const entry = await createPiSession(clientSessionId, sessionName, model, workingDirectory, providerConfig);

  // If the SDK exposes sessionFile and we want to switch: use runtime approach later
  // For now, the history comes from our own DB; PI SDK starts fresh.
  // TODO: implement AgentSessionRuntime switchSession if needed
  return entry;
}

// ── sendPiPrompt ────────────────────────────────────────────────────
export async function sendPiPrompt(clientSessionId, promptText, images = null) {
  const entry = piSessions.get(clientSessionId);
  if (!entry) throw new Error('PI session not found: ' + clientSessionId);
  if (entry._sending) throw new Error('A response is already being generated');

  log(`🚀 sendPiPrompt called for ${clientSessionId}: "${promptText.slice(0, 60)}..."`);
  if (images?.length) {
    log(`   with ${images.length} image(s)`);
  }
  entry._sending = true;
  entry._sendingTimeout = setTimeout(() => {
    if (entry._sending) {
      log(`⚠️ PI prompt stuck for ${clientSessionId} — resetting after timeout`);
      entry._sending = false;
      entry.onError?.('Response timed out. Please try again.');
    }
  }, 120000);

  try {
    log(`⏳ Calling session.prompt() for ${clientSessionId}...`);
    if (images?.length > 0) {
      await entry.session.prompt(promptText, { images, expandPromptTemplates: true });
    } else {
      await entry.session.prompt(promptText);
    }
    entry._sending = false;
    if (entry._sendingTimeout) { clearTimeout(entry._sendingTimeout); entry._sendingTimeout = null; }
    log(`✅ PI prompt completed for ${clientSessionId}`);
  } catch (err) {
    entry._sending = false;
    if (entry._sendingTimeout) { clearTimeout(entry._sendingTimeout); entry._sendingTimeout = null; }
    log(`❌ PI prompt failed for ${clientSessionId}:`, err.message);
    entry.onError?.(err.message);
    throw err;
  }
}

// ── abortPiSession ─────────────────────────────────────────────────
export async function abortPiSession(clientSessionId) {
  const entry = piSessions.get(clientSessionId);
  if (entry?.session?.abort) {
    try { await entry.session.abort(); } catch (e) { /* ignore */ }
  }
  if (entry) {
    entry._sending = false;
    if (entry._sendingTimeout) { clearTimeout(entry._sendingTimeout); entry._sendingTimeout = null; }
  }
}

// ── endPiSession ────────────────────────────────────────────────────
export function endPiSession(clientSessionId) {
  const entry = piSessions.get(clientSessionId);
  if (entry) {
    if (entry._sendingTimeout) { clearTimeout(entry._sendingTimeout); }
    try { entry.session?.dispose?.(); } catch (e) { /* ignore */ }
    piSessions.delete(clientSessionId);
    log(`🗑️ PI session ended: ${clientSessionId}`);
  }
}

// ── getPiState ──────────────────────────────────────────────────────
export function getPiState(clientSessionId) {
  const entry = piSessions.get(clientSessionId);
  if (!entry) return null;
  return {
    sessionFile: entry.sessionFile,
    sessionId: entry.piSessionId,
    messages: entry.session?.messages || [],
  };
}

// ── getPiSessionFile ────────────────────────────────────────────────
export function getPiSessionFile(clientSessionId) {
  return piSessions.get(clientSessionId)?.sessionFile || null;
}

// ── getPiMessages ───────────────────────────────────────────────────
export function getPiMessages(clientSessionId) {
  const entry = piSessions.get(clientSessionId);
  const msgs = entry?.session?.messages || [];
  return msgs.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    timestamp: Date.now()
  }));
}

// ── listPiSessions ──────────────────────────────────────────────────
export function listPiSessions() {
  return Array.from(piSessions.keys());
}

// ── respondToPiExtensionUI ──────────────────────────────────────────
export function respondToPiExtensionUI(clientSessionId, requestId, responsePayload) {
  log(`🔌 Extension UI response not yet wired for SDK mode: ${clientSessionId}`);
}

export { buildProviderConfig, fetchAvailableOllamaModels, validateOllamaModel };
