/**
 * Copilot CLI Adapter
 * Spawns the copilot CLI as a child process and manages communication
 */

import { spawn } from 'child_process';
import { platform } from 'os';

// Store active CLI sessions
const cliSessions = new Map(); // sessionId -> { process, buffer, callbacks }

/**
 * Spawn a new Copilot CLI session
 */
export async function createCliSession(sessionId, sessionName) {
  const cliPath = 'copilot';
  
  // Spawn copilot with named session
  const args = [
    '--name', sessionName,
    '--allow-all-tools', // Auto-approve for web UI
    '--banner', 'false'  // Hide startup banner
  ];
  
  console.log(`🚀 Spawning Copilot CLI: ${cliPath} ${args.join(' ')}`);
  
  const proc = spawn(cliPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  const session = {
    process: proc,
    sessionId,
    sessionName,
    buffer: '',
    messageQueue: [],
    initialized: false,
    onMessage: null,
    onError: null
  };
  
  // Handle stdout (assistant responses)
  proc.stdout.on('data', (data) => {
    const text = data.toString();
    session.buffer += text;
    
    // Check for the prompt indicator (CLI is ready for input)
    if (text.includes('>') || text.includes('?')) {
      session.initialized = true;
    }
    
    // Stream to callback if set
    if (session.onMessage) {
      session.onMessage(text);
    }
    
    console.log(`📝 CLI stdout [${sessionId}]:`, text.substring(0, 200));
  });
  
  // Handle stderr (errors/warnings)
  proc.stderr.on('data', (data) => {
    const text = data.toString();
    console.error(`⚠️ CLI stderr [${sessionId}]:`, text);
    
    if (session.onError) {
      session.onError(text);
    }
  });
  
  // Handle process exit
  proc.on('close', (code) => {
    console.log(`👋 CLI session ${sessionId} exited with code ${code}`);
    cliSessions.delete(sessionId);
  });
  
  proc.on('error', (err) => {
    console.error(`❌ CLI session ${sessionId} error:`, err);
    if (session.onError) {
      session.onError(err.message);
    }
  });
  
  cliSessions.set(sessionId, session);
  
  // Wait a bit for CLI to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return session;
}

/**
 * Resume an existing Copilot CLI session
 */
export async function resumeCliSession(sessionId, sessionName) {
  const cliPath = 'copilot';
  
  // Spawn copilot resuming the named session
  const args = [
    '--resume', sessionName,
    '--allow-all-tools',
    '--banner', 'false'
  ];
  
  console.log(`🔄 Resuming Copilot CLI: ${cliPath} ${args.join(' ')}`);
  
  const proc = spawn(cliPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  const session = {
    process: proc,
    sessionId,
    sessionName,
    buffer: '',
    messageQueue: [],
    initialized: false,
    onMessage: null,
    onError: null
  };
  
  proc.stdout.on('data', (data) => {
    const text = data.toString();
    session.buffer += text;
    session.initialized = true;
    
    if (session.onMessage) {
      session.onMessage(text);
    }
    
    console.log(`📝 CLI stdout [${sessionId}]:`, text.substring(0, 200));
  });
  
  proc.stderr.on('data', (data) => {
    const text = data.toString();
    console.error(`⚠️ CLI stderr [${sessionId}]:`, text);
    
    if (session.onError) {
      session.onError(text);
    }
  });
  
  proc.on('close', (code) => {
    console.log(`👋 CLI session ${sessionId} exited with code ${code}`);
    cliSessions.delete(sessionId);
  });
  
  cliSessions.set(sessionId, session);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return session;
}

/**
 * Send a message to a CLI session
 */
export async function sendToCliSession(sessionId, message) {
  const session = cliSessions.get(sessionId);
  
  if (!session) {
    throw new Error(`CLI session ${sessionId} not found`);
  }
  
  if (!session.process || session.process.killed) {
    throw new Error(`CLI session ${sessionId} is not running`);
  }
  
  console.log(`📤 Sending to CLI [${sessionId}]:`, message.substring(0, 100));
  
  // Send message to CLI stdin
  session.process.stdin.write(message + '\n');
  
  return true;
}

/**
 * Get a CLI session
 */
export function getCliSession(sessionId) {
  return cliSessions.get(sessionId);
}

/**
 * End a CLI session
 */
export async function endCliSession(sessionId) {
  const session = cliSessions.get(sessionId);
  
  if (!session) {
    return false;
  }
  
  console.log(`🛑 Ending CLI session ${sessionId}`);
  
  // Send exit command
  try {
    session.process.stdin.write('/exit\n');
  } catch (e) {}
  
  // Wait a bit then kill if needed
  setTimeout(() => {
    if (session.process && !session.process.killed) {
      session.process.kill();
    }
  }, 1000);
  
  cliSessions.delete(sessionId);
  return true;
}

/**
 * List active CLI sessions
 */
export function listCliSessions() {
  return Array.from(cliSessions.keys());
}

export default {
  createCliSession,
  resumeCliSession,
  sendToCliSession,
  getCliSession,
  endCliSession,
  listCliSessions
};