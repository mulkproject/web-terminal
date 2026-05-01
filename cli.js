#!/usr/bin/env node
/**
 * Cline CLI TUI - Terminal User Interface for Cline
 * 
 * A full terminal-based interface for chatting with Cline agent
 * with project selection, chat history, and streaming responses.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

// Import database functions
import { 
  initDatabase, 
  closeDatabase, 
  authenticateUser, 
  getSessionsByUser, 
  getSession, 
  getMessages, 
  createSession, 
  addMessage, 
  deleteSession,
  generateSessionToken,
  validateSessionToken
} from './database.js';

// Import ClineAgent
import ClineAgent from 'cline';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_TOKEN = process.env.OLLAMA_TOKEN || '';

// Global state
let agent = null;
let currentSessionId = null;
let currentAgentSessionId = null;
let currentCwd = WORKSPACE_DIR;
let messages = [];
let isProcessing = false;
let streamingContent = '';
let userId = null;
let userEmail = null;

// Session mappings
const sessionAgentMap = new Map();
const sessionContext = new Map();
const streamingMessages = new Map();

// Blessed screen and components
let screen = null;
let chatBox = null;
let inputBox = null;
let statusBar = null;
let projectList = null;
let modeSelector = null;

// ANSI color codes for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',
};

/**
 * Clear screen and show banner
 */
function showBanner() {
  console.clear();
  console.log(`${colors.cyan}${colors.bright}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║              🤖 CLINE TUI - Terminal Interface            ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);
  console.log();
}

/**
 * Create readline interface for prompts
 */
function createReadline() {
  return createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt for input
 */
function prompt(rl, question, hidden = false) {
  return new Promise((resolve) => {
    if (hidden) {
      // For password input
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let input = '';
      process.stdin.on('data', (char) => {
        const c = char.toString('utf8');
        switch (c) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write('\n');
            resolve(input);
            break;
          case '\u0003': // Ctrl+C
            process.exit();
            break;
          case '\u007F': // Backspace
            input = input.slice(0, -1);
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(question + '*'.repeat(input.length));
            break;
          default:
            input += c;
            process.stdout.write('*');
            break;
        }
      });
    } else {
      rl.question(question, (answer) => {
        resolve(answer);
      });
    }
  });
}

/**
 * Select from a list of options
 */
async function selectFromList(rl, title, options, allowBack = false) {
  console.log(`${colors.cyan}${colors.bright}${title}${colors.reset}\n`);
  
  options.forEach((option, index) => {
    const num = `${colors.dim}${index + 1}.${colors.reset}`;
    console.log(`  ${num} ${option.label}`);
  });
  
  if (allowBack) {
    console.log(`  ${colors.dim}0.${colors.reset} Back`);
  }
  console.log();
  
  const answer = await prompt(rl, `Select option [1-${options.length}]: `);
  const index = parseInt(answer) - 1;
  
  if (answer === '0' && allowBack) {
    return null;
  }
  
  if (index >= 0 && index < options.length) {
    return options[index];
  }
  
  return null;
}

/**
 * Authenticate user
 */
async function authenticate() {
  const rl = createReadline();
  
  console.log(`${colors.yellow}Authentication Required${colors.reset}`);
  console.log(`Default credentials: admin@mail.com / admin123\n`);
  
  const email = await prompt(rl, 'Email: ');
  const password = await prompt(rl, 'Password: ', true);
  
  rl.close();
  
  const result = await authenticateUser(email, password);
  
  if (result.success) {
    userId = result.user.id;
    userEmail = result.user.email;
    console.log(`${colors.green}✓ Authenticated as ${email}${colors.reset}\n`);
    return true;
  } else {
    console.log(`${colors.red}✗ Authentication failed: ${result.message}${colors.reset}\n`);
    return false;
  }
}

/**
 * Browse and select a project folder
 */
async function browseFolders(startPath = WORKSPACE_DIR) {
  const rl = createReadline();
  let currentPath = resolve(startPath);
  
  while (true) {
    console.log(`\n${colors.cyan}${colors.bright}Browse Folder: ${currentPath}${colors.reset}\n`);
    
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      const folders = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name));
      
      const options = [
        { label: `${colors.green}✓ Use this folder${colors.reset}`, value: 'select', path: currentPath },
        { label: `${colors.yellow}📁 .. (parent)${colors.reset}`, value: 'parent', path: dirname(currentPath) }
      ];
      
      folders.forEach(folder => {
        options.push({ 
          label: `📁 ${folder.name}`, 
          value: 'folder', 
          path: join(currentPath, folder.name) 
        });
      });
      
      const selected = await selectFromList(rl, 'Select a folder:', options, false);
      
      if (selected) {
        if (selected.value === 'select') {
          rl.close();
          return currentPath;
        } else {
          currentPath = selected.path;
        }
      }
    } catch (err) {
      console.log(`${colors.red}Error reading folder: ${err.message}${colors.reset}`);
      currentPath = dirname(currentPath);
    }
  }
}

/**
 * Initialize ClineAgent
 */
async function initAgent() {
  if (agent) return agent;
  
  console.log(`${colors.dim}Initializing ClineAgent...${colors.reset}`);
  
  agent = new ClineAgent({
    debug: process.env.DEBUG === 'true',
    defaultProvider: 'ollama',
    providers: {
      ollama: {
        baseUrl: OLLAMA_BASE_URL,
        model: OLLAMA_MODEL,
        authToken: OLLAMA_TOKEN || undefined
      }
    }
  });
  
  // Set up permission handler (auto-approve)
  agent.setPermissionHandler(async (request) => {
    const allowOption = request.options?.find(o => o.kind === 'allow' || o.kind === 'accept');
    if (allowOption) {
      return { optionId: allowOption.optionId, kind: allowOption.kind };
    }
    if (request.options?.length > 0) {
      return { optionId: request.options[0].optionId, kind: request.options[0].kind };
    }
    return { kind: 'deny' };
  });
  
  await agent.initialize({ clientCapabilities: {} });
  
  console.log(`${colors.green}✓ ClineAgent initialized${colors.reset}`);
  console.log(`${colors.dim}Ollama: ${OLLAMA_BASE_URL} (model: ${OLLAMA_MODEL})${colors.reset}\n`);
  
  return agent;
}

/**
 * Create a new session
 */
async function createNewSession(cwd) {
  const sessionResponse = await agent.newSession({
    cwd: cwd,
    mcpServers: []
  });
  
  const sessionId = sessionResponse.sessionId;
  
  // Store in database
  createSession(sessionId, cwd, basename(cwd), userId);
  
  // Set up event listeners
  setupSessionEvents(sessionId);
  
  return sessionId;
}

/**
 * Set up event listeners for a session
 */
function setupSessionEvents(sessionId) {
  const emitter = agent.emitterForSession(sessionId);
  
  const eventTypes = [
    'agent_message_chunk',
    'tool_call',
    'tool_call_update',
    'session_update',
    'error'
  ];
  
  eventTypes.forEach(eventType => {
    emitter.on(eventType, (payload) => {
      handleAgentEvent(eventType, sessionId, payload);
    });
  });
  
  emitter.on('agent_message_chunk', (payload) => {
    const chunkContent = payload?.content?.text || payload?.chunk || payload?.text || 
      (typeof payload?.content === 'string' ? payload.content : '');
    if (chunkContent) {
      streamingContent += chunkContent;
    }
  });
}

/**
 * Handle agent events
 */
function handleAgentEvent(eventType, sessionId, payload) {
  if (eventType === 'tool_call') {
    const toolName = payload?.toolName || payload?.name || 'unknown';
    appendToChat(`${colors.yellow}🔧 Tool: ${toolName}${colors.reset}\n`);
  } else if (eventType === 'tool_call_update') {
    const status = payload?.status || payload?.update || '';
    if (status) {
      appendToChat(`${colors.dim}   ${status}${colors.reset}\n`);
    }
  } else if (eventType === 'error') {
    appendToChat(`${colors.red}Error: ${payload?.message || JSON.stringify(payload)}${colors.reset}\n`);
  }
}

/**
 * Append text to chat display
 */
function appendToChat(text) {
  if (screen) {
    chatBox.pushLine(text);
    chatBox.setScrollPerc(100);
    screen.render();
  } else {
    process.stdout.write(text);
  }
}

/**
 * Send a prompt to Cline
 */
async function sendPrompt(content) {
  if (!currentSessionId || isProcessing) return;
  
  isProcessing = true;
  streamingContent = '';
  
  // Display user message
  appendToChat(`\n${colors.blue}${colors.bright}You:${colors.reset} ${content}\n`);
  
  // Save user message
  addMessage(currentSessionId, 'user', content);
  
  // Update status
  if (statusBar) {
    statusBar.setContent(`${colors.yellow}⏳ Processing...${colors.reset}`);
    screen.render();
  }
  
  try {
    // Check for context from loaded session
    const contextData = sessionContext.get(currentSessionId);
    let promptContent = content.trim();
    
    if (contextData && contextData.firstPrompt && contextData.messages?.length > 0) {
      const contextParts = ['[Previous conversation context from loaded session:]'];
      const recentMessages = contextData.messages.slice(-20);
      for (const msg of recentMessages) {
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        contextParts.push(`\n${roleLabel}: ${msg.content}`);
      }
      contextParts.push('\n[End of previous context. Continue from here:]\n');
      promptContent = contextParts.join('') + promptContent;
      contextData.firstPrompt = false;
    }
    
    // Send prompt
    const response = await agent.prompt({
      sessionId: currentAgentSessionId,
      prompt: [{ type: 'text', text: promptContent }]
    });
    
    // Get assistant content
    let assistantContent = streamingContent || response?.text || response?.content || '';
    
    if (assistantContent.trim()) {
      // Display assistant message
      appendToChat(`\n${colors.green}${colors.bright}Cline:${colors.reset} ${assistantContent}\n`);
      
      // Save assistant message
      addMessage(currentSessionId, 'assistant', assistantContent);
    }
    
    // Update status
    if (statusBar) {
      statusBar.setContent(`${colors.green}✓ Ready${colors.reset}`);
      screen.render();
    }
    
  } catch (err) {
    appendToChat(`${colors.red}Error: ${err.message}${colors.reset}\n`);
    if (statusBar) {
      statusBar.setContent(`${colors.red}✗ Error${colors.reset}`);
      screen.render();
    }
  }
  
  isProcessing = false;
  streamingContent = '';
}

/**
 * Build the blessed TUI screen
 */
function buildTUI() {
  // Create screen
  screen = blessed.screen({
    smartCSR: true,
    title: 'Cline TUI',
    fullUnicode: true,
    dockBorders: true
  });
  
  // Create grid layout
  const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });
  
  // Project list (left side)
  projectList = grid.set(0, 0, 10, 3, blessed.list, {
    label: ' Projects ',
    keys: true,
    vi: true,
    mouse: true,
    style: {
      selected: {
        bg: 'blue',
        fg: 'white',
        bold: true
      },
      item: {
        fg: 'white'
      }
    },
    border: { type: 'line' },
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { inverse: true }
    }
  });
  
  // Chat box (main area)
  chatBox = grid.set(0, 3, 10, 7, blessed.box, {
    label: ' Chat ',
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { inverse: true }
    },
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' }
    }
  });
  
  // Mode selector (right side)
  modeSelector = grid.set(0, 10, 10, 2, blessed.list, {
    label: ' Mode ',
    keys: true,
    vi: true,
    mouse: true,
    items: ['🤖 Act', '📋 Plan'],
    style: {
      selected: {
        bg: 'cyan',
        fg: 'black',
        bold: true
      },
      item: {
        fg: 'white'
      }
    },
    border: { type: 'line' }
  });
  
  // Input box (bottom)
  inputBox = grid.set(10, 0, 1, 12, blessed.textbox, {
    label: ' Message (Enter to send, Esc to cancel) ',
    keys: true,
    mouse: true,
    inputOnFocus: true,
    style: {
      border: { fg: 'green' },
      focus: {
        border: { fg: 'cyan' }
      }
    },
    border: { type: 'line' }
  });
  
  // Status bar (bottom)
  statusBar = grid.set(11, 0, 1, 12, blessed.box, {
    content: `${colors.green}✓ Ready${colors.reset}`,
    style: {
      bg: 'black'
    }
  });
  
  // Input box events
  inputBox.on('submit', async (value) => {
    if (value && value.trim()) {
      await sendPrompt(value.trim());
      inputBox.clearValue();
      screen.render();
      inputBox.focus();
    }
  });
  
  inputBox.on('cancel', () => {
    inputBox.clearValue();
    screen.render();
  });
  
  // Project list events
  projectList.on('select', async (item, index) => {
    const selected = projectListItems[index];
    if (selected) {
      if (selected.action === 'new') {
        // Create new project
        screen.exec('node', [join(__dirname, 'cli.js'), '--select-folder'], 
          { cwd: process.cwd() }, 
          async (err, stdout, stderr) => {}
        );
      } else if (selected.sessionId) {
        // Load existing session
        await loadSession(selected.sessionId);
      }
    }
  });
  
  // Mode selector events
  modeSelector.on('select', async (item, index) => {
    const mode = index === 0 ? 'act' : 'plan';
    if (currentAgentSessionId) {
      try {
        await agent.setSessionMode({ sessionId: currentAgentSessionId, mode });
        statusBar.setContent(`${colors.green}✓ Mode: ${mode}${colors.reset}`);
        screen.render();
      } catch (err) {
        // Ignore mode errors
      }
    }
  });
  
  // Key bindings
  screen.key(['C-c'], async () => {
    await shutdown();
    process.exit(0);
  });
  
  screen.key(['escape'], () => {
    inputBox.focus();
  });
  
  screen.key(['tab'], () => {
    if (screen.focused === inputBox) {
      chatBox.focus();
    } else if (screen.focused === chatBox) {
      projectList.focus();
    } else if (screen.focused === projectList) {
      modeSelector.focus();
    } else {
      inputBox.focus();
    }
  });
  
  // Focus input
  inputBox.focus();
  
  return screen;
}

// Project list items storage
let projectListItems = [];

/**
 * Load sessions into project list
 */
async function loadProjectList() {
  projectListItems = [];
  const sessions = getSessionsByUser(userId);
  
  // Add "New Project" option
  projectListItems.push({
    label: `${colors.green}+ New Project${colors.reset}`,
    action: 'new'
  });
  
  // Add existing sessions
  for (const session of sessions) {
    const msgCount = await getMessages(session.id, 1000).length;
    projectListItems.push({
      label: `📁 ${session.workspace_name || basename(session.workspace_path)}`,
      sessionId: session.id,
      cwd: session.workspace_path
    });
  }
  
  // Update list
  projectList.setItems(projectListItems.map(i => i.label));
  screen.render();
}

/**
 * Load an existing session
 */
async function loadSession(sessionId) {
  const dbSession = getSession(sessionId);
  
  if (!dbSession) {
    appendToChat(`${colors.red}Session not found${colors.reset}\n`);
    return;
  }
  
  // Create new agent session
  const agentResponse = await agent.newSession({
    cwd: dbSession.workspace_path,
    mcpServers: []
  });
  
  currentAgentSessionId = agentResponse.sessionId;
  currentSessionId = sessionId;
  currentCwd = dbSession.workspace_path;
  
  sessionAgentMap.set(sessionId, currentAgentSessionId);
  
  // Set up events
  setupSessionEvents(currentAgentSessionId);
  
  // Get messages
  const messages = getMessages(sessionId, 100);
  
  // Store context for first prompt
  sessionContext.set(sessionId, {
    messages: messages,
    firstPrompt: true,
    workspacePath: dbSession.workspace_path
  });
  
  // Update chat
  chatBox.setContent('');
  appendToChat(`${colors.cyan}Loaded session: ${dbSession.workspace_name || basename(dbSession.workspace_path)}${colors.reset}\n`);
  appendToChat(`${colors.dim}Path: ${dbSession.workspace_path}${colors.reset}\n\n`);
  
  // Show history
  for (const msg of messages.slice(-20)) { // Show last 20 messages
    if (msg.role === 'user') {
      appendToChat(`${colors.blue}You:${colors.reset} ${msg.content}\n`);
    } else {
      appendToChat(`${colors.green}Cline:${colors.reset} ${msg.content}\n`);
    }
  }
  
  // Update status
  statusBar.setContent(`${colors.green}✓ Ready (${basename(currentCwd)})${colors.reset}`);
  screen.render();
}

/**
 * Simple chat mode (no TUI - for environments without full terminal support)
 */
async function simpleChatMode() {
  const rl = createReadline();
  
  console.log(`${colors.cyan}Simple Chat Mode${colors.reset}`);
  console.log(`Type your message and press Enter. Type 'exit' to quit.\n`);
  
  // Load project list
  const sessions = getSessionsByUser(userId);
  
  if (sessions.length > 0) {
    console.log(`${colors.yellow}Recent Projects:${colors.reset}`);
    sessions.slice(0, 5).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.workspace_name || basename(s.workspace_path)}`);
    });
    console.log(`  n. New project`);
    console.log();
    
    const selection = await prompt(rl, 'Select project (1-n, or press Enter for new): ');
    
    if (selection && !isNaN(selection)) {
      const index = parseInt(selection) - 1;
      if (index >= 0 && index < sessions.length) {
        // Load existing session
        const session = sessions[index];
        const agentResponse = await agent.newSession({
          cwd: session.workspace_path,
          mcpServers: []
        });
        
        currentAgentSessionId = agentResponse.sessionId;
        currentSessionId = session.id;
        currentCwd = session.workspace_path;
        
        sessionAgentMap.set(session.id, currentAgentSessionId);
        setupSessionEvents(currentAgentSessionId);
        
        // Get messages for context
        const msgs = getMessages(session.id, 100);
        sessionContext.set(session.id, {
          messages: msgs,
          firstPrompt: true,
          workspacePath: session.workspace_path
        });
        
        console.log(`${colors.green}✓ Loaded: ${session.workspace_name || basename(session.workspace_path)}${colors.reset}\n`);
        
        // Show recent history
        if (msgs.length > 0) {
          console.log(`${colors.dim}--- Last ${Math.min(msgs.length, 5)} messages ---${colors.reset}`);
          msgs.slice(-5).forEach(msg => {
            const prefix = msg.role === 'user' ? `${colors.blue}You:${colors.reset}` : `${colors.green}Cline:${colors.reset}`;
            const content = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '');
            console.log(`${prefix} ${content}`);
          });
          console.log(`${colors.dim}--------------------------------${colors.reset}\n`);
        }
      }
    } else {
      // Create new project
      const cwd = await browseFolders();
      currentSessionId = await createNewSession(cwd);
      currentAgentSessionId = currentSessionId;
      currentCwd = cwd;
      console.log(`${colors.green}✓ Created new project: ${basename(cwd)}${colors.reset}\n`);
    }
  } else {
    // No existing sessions - create new
    const cwd = await browseFolders();
    currentSessionId = await createNewSession(cwd);
    currentAgentSessionId = currentSessionId;
    currentCwd = cwd;
    console.log(`${colors.green}✓ Created new project: ${basename(cwd)}${colors.reset}\n`);
  }
  
  // Chat loop
  console.log(`${colors.cyan}Chat ready. Type your message (or 'exit' to quit):${colors.reset}\n`);
  
  while (true) {
    const input = await prompt(rl, `${colors.blue}You:${colors.reset} `);
    
    if (!input || input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      break;
    }
    
    if (input.trim()) {
      isProcessing = true;
      streamingContent = '';
      
      console.log(`${colors.dim}Processing...${colors.reset}`);
      
      try {
        // Check for context
        const contextData = sessionContext.get(currentSessionId);
        let promptContent = input.trim();
        
        if (contextData && contextData.firstPrompt && contextData.messages?.length > 0) {
          const contextParts = ['[Previous conversation context:]'];
          const recentMessages = contextData.messages.slice(-20);
          for (const msg of recentMessages) {
            const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
            contextParts.push(`\n${roleLabel}: ${msg.content}`);
          }
          contextParts.push('\n[End of context. New message:]\n');
          promptContent = contextParts.join('') + promptContent;
          contextData.firstPrompt = false;
        }
        
        addMessage(currentSessionId, 'user', input.trim());
        
        const response = await agent.prompt({
          sessionId: currentAgentSessionId,
          prompt: [{ type: 'text', text: promptContent }]
        });
        
        const assistantContent = streamingContent || response?.text || response?.content || '';
        
        if (assistantContent.trim()) {
          console.log(`${colors.green}Cline:${colors.reset} ${assistantContent}\n`);
          addMessage(currentSessionId, 'assistant', assistantContent);
        }
        
      } catch (err) {
        console.log(`${colors.red}Error: ${err.message}${colors.reset}\n`);
      }
      
      isProcessing = false;
      streamingContent = '';
    }
  }
  
  rl.close();
}

/**
 * Shutdown cleanup
 */
async function shutdown() {
  if (agent) {
    await agent.shutdown();
  }
  closeDatabase();
}

/**
 * Main entry point
 */
async function main() {
  showBanner();
  
  // Check for command line args
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`${colors.cyan}Cline TUI - Terminal Interface for Cline${colors.reset}\n`);
    console.log('Usage: node cli.js [options]\n');
    console.log('Options:');
    console.log('  --simple        Use simple mode (no TUI)');
    console.log('  --select-folder  Browse and select a project folder');
    console.log('  --help, -h      Show this help message');
    console.log('\nEnvironment Variables:');
    console.log('  WORKSPACE_DIR   Default workspace directory');
    console.log('  OLLAMA_BASE_URL Ollama server URL');
    console.log('  OLLAMA_MODEL    Model to use');
    process.exit(0);
  }
  
  // Initialize database
  await initDatabase();
  
  // Authenticate
  const authenticated = await authenticate();
  if (!authenticated) {
    process.exit(1);
  }
  
  // Initialize agent
  await initAgent();
  
  // Check if simple mode requested or if TUI not available
  const useSimpleMode = args.includes('--simple') || !process.stdout.isTTY;
  
  if (useSimpleMode) {
    await simpleChatMode();
  } else {
    // Check if folder selection requested
    if (args.includes('--select-folder')) {
      const cwd = await browseFolders();
      currentSessionId = await createNewSession(cwd);
      currentAgentSessionId = currentSessionId;
      currentCwd = cwd;
    }
    
    // Build and run TUI
    buildTUI();
    await loadProjectList();
    
    // Initial welcome message
    appendToChat(`${colors.cyan}Welcome to Cline TUI!${colors.reset}\n`);
    appendToChat(`${colors.dim}Model: ${OLLAMA_MODEL}${colors.reset}\n`);
    appendToChat(`${colors.dim}Workspace: ${WORKSPACE_DIR}${colors.reset}\n\n`);
    appendToChat(`Select a project from the left or create a new one.\n`);
    appendToChat(`Press Tab to navigate between panels.\n`);
    appendToChat(`Press Ctrl+C to exit.\n\n`);
    
    screen.render();
    
    // Keep process alive
    process.stdin.resume();
  }
  
  await shutdown();
}

// Handle errors
process.on('uncaughtException', async (err) => {
  console.error(`${colors.red}Uncaught exception: ${err.message}${colors.reset}`);
  await shutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error(`${colors.red}Unhandled rejection: ${reason}${colors.reset}`);
  await shutdown();
  process.exit(1);
});

// Run
main().catch(console.error);