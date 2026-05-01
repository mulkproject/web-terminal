#!/usr/bin/env node
/**
 * Web Terminal CLI Launcher
 * 
 * A command-line interface for launching the Web Terminal server
 * Supports both direct Node.js and PM2 process management
 * 
 * Features:
 * - Port conflict detection with option to kill existing process
 * - Interactive mode selection (Direct / PM2)
 * - Status monitoring
 * - Log viewing
 * 
 * Usage:
 *   node launcher-cli.js [command] [options]
 * 
 * Commands:
 *   start       Start the server
 *   stop        Stop the server
 *   restart     Restart the server
 *   status      Show server status
 *   logs        Show server logs
 * 
 * Options:
 *   --port      Port to use (default: 3456)
 *   --host      Host to bind (default: localhost)
 *   --local     Local access only (localhost) - most secure
 *   --network   Allow network access (0.0.0.0) - accessible from other devices
 *   --pm2       Use PM2 for process management
 *   --direct    Use direct Node.js (no PM2)
 *   --force     Force start even if port is in use
 */

import { exec, execSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import net from 'net';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Configuration
const CONFIG_FILE = join(__dirname, 'launcher-config.json');
const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 3456,
  ollama_url: 'http://localhost:11434',
  mode: 'direct', // 'direct' or 'pm2'
  chat_enabled: true
};

let config = { ...DEFAULT_CONFIG };

// Load configuration
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...saved };
    }
  } catch (e) {
    console.log(`${colors.yellow}⚠️ Could not load config, using defaults${colors.reset}`);
  }
}

// Save configuration
function saveConfig() {
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.log(`${colors.yellow}⚠️ Could not save config${colors.reset}`);
  }
}

// Create readline interface
function createRL() {
  return createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

// Check if port is in use
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    
    server.listen(port);
  });
}

// Get process using a port (Windows)
function getProcessOnPortWindows(port) {
  try {
    // Try netstat first
    const result = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    
    if (result) {
      const lines = result.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(parseInt(pid))) {
          try {
            const processInfo = execSync(`tasklist /fi "pid eq ${pid}" /fo csv /nh`, {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'ignore']
            });
            const processName = processInfo.split(',')[0].replace(/"/g, '');
            return { pid: parseInt(pid), name: processName };
          } catch (e) {
            return { pid: parseInt(pid), name: 'Unknown' };
          }
        }
      }
    }
  } catch (e) {
    // netstat failed, try alternative
  }
  
  return null;
}

// Get process using a port (Linux/Mac)
function getProcessOnPortUnix(port) {
  try {
    const result = execSync(`lsof -ti:${port} | head -1`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    
    if (result) {
      const pid = result.trim();
      if (pid) {
        try {
          const processInfo = execSync(`ps -p ${pid} -o comm=`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          return { pid: parseInt(pid), name: processInfo.trim() };
        } catch (e) {
          return { pid: parseInt(pid), name: 'Unknown' };
        }
      }
    }
  } catch (e) {
    // lsof failed
  }
  
  return null;
}

// Get process using a port
function getProcessOnPort(port) {
  if (os.platform() === 'win32') {
    return getProcessOnPortWindows(port);
  } else {
    return getProcessOnPortUnix(port);
  }
}

// Kill process by PID
function killProcess(pid, force = false) {
  try {
    if (os.platform() === 'win32') {
      execSync(`taskkill ${force ? '/F' : ''} /PID ${pid}`, { stdio: 'ignore' });
    } else {
      execSync(`kill ${force ? '-9' : ''} ${pid}`, { stdio: 'ignore' });
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Check if PM2 is installed
function isPM2Installed() {
  try {
    execSync('pm2 --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Check if server is running via PM2
function isPM2Running() {
  try {
    const result = execSync('pm2 list', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return result.includes('terminal-web-ui');
  } catch (e) {
    return false;
  }
}

// Print banner
function printBanner() {
  console.log(`${colors.cyan}${colors.bright}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║           🖥️  Web Terminal CLI Launcher                     ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);
}

// Print help
function printHelp() {
  console.log(`${colors.white}Usage: node launcher-cli.js [command] [options]${colors.reset}\n`);
  console.log(`${colors.bright}Commands:${colors.reset}`);
  console.log(`  ${colors.green}start${colors.reset}       Start the server`);
  console.log(`  ${colors.green}stop${colors.reset}        Stop the server`);
  console.log(`  ${colors.green}restart${colors.reset}     Restart the server`);
  console.log(`  ${colors.green}status${colors.reset}      Show server status`);
  console.log(`  ${colors.green}logs${colors.reset}        Show server logs`);
  console.log(`  ${colors.green}interactive${colors.reset} Interactive mode selection${colors.reset}\n`);
  console.log(`${colors.bright}Options:${colors.reset}`);
  console.log(`  ${colors.yellow}--port${colors.reset}      Port to use (default: ${config.port})`);
  console.log(`  ${colors.yellow}--host${colors.reset}      Host to bind (default: ${config.host})`);
  console.log(`  ${colors.yellow}--local${colors.reset}     Local access only (localhost)`);
  console.log(`  ${colors.yellow}--network${colors.reset}    Allow network access (0.0.0.0)`);
  console.log(`  ${colors.yellow}--pm2${colors.reset}       Use PM2 for process management`);
  console.log(`  ${colors.yellow}--direct${colors.reset}    Use direct Node.js (no PM2)`);
  console.log(`  ${colors.yellow}--force${colors.reset}     Force start even if port is in use`);
  console.log(`  ${colors.yellow}--help${colors.reset}      Show this help message\n`);
}

// Ask question
function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Start server with port checking
async function startServer(options = {}) {
  const port = options.port || config.port;
  const host = options.host || config.host;
  const usePM2 = options.pm2 || config.mode === 'pm2';
  const force = options.force || false;
  
  console.log(`${colors.cyan}🔍 Checking port ${port}...${colors.reset}`);
  
  const portInUse = await isPortInUse(port);
  
  if (portInUse) {
    const processInfo = getProcessOnPort(port);
    
    console.log(`${colors.yellow}⚠️  Port ${port} is already in use!${colors.reset}`);
    
    if (processInfo) {
      console.log(`${colors.dim}   Process: ${processInfo.name} (PID: ${processInfo.pid})${colors.reset}`);
    }
    
    if (force) {
      console.log(`${colors.yellow}⚠️  Force mode enabled, attempting to kill process...${colors.reset}`);
      if (processInfo && killProcess(processInfo.pid, true)) {
        console.log(`${colors.green}✅ Process killed${colors.reset}`);
        // Wait a moment for port to be released
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.log(`${colors.red}❌ Could not kill process${colors.reset}`);
        return false;
      }
    } else {
      const rl = createRL();
      const answer = await ask(rl, `${colors.cyan}Do you want to kill the process using port ${port}? [y/N]: ${colors.reset}`);
      rl.close();
      
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        if (processInfo && killProcess(processInfo.pid, true)) {
          console.log(`${colors.green}✅ Process killed${colors.reset}`);
          // Wait a moment for port to be released
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log(`${colors.red}❌ Could not kill process. Try running as administrator.${colors.reset}`);
          return false;
        }
      } else {
        console.log(`${colors.yellow}⚠️  Cannot start server on port ${port}${colors.reset}`);
        return false;
      }
    }
  }
  
  // Update config
  config.port = port;
  config.host = host;
  if (usePM2) {
    config.mode = 'pm2';
  } else {
    config.mode = 'direct';
  }
  saveConfig();
  
  // Show network mode warning
  if (host === '0.0.0.0') {
    console.log(`\n${colors.yellow}⚠️  Network mode enabled - Server will be accessible from other devices${colors.reset}`);
    console.log(`${colors.dim}   Make sure your firewall allows port ${port}${colors.reset}\n`);
  }
  
  if (usePM2) {
    return startWithPM2(port, host);
  } else {
    return startDirect(port, host);
  }
}

// Start with PM2
function startWithPM2(port, host) {
  return new Promise((resolve) => {
    if (!isPM2Installed()) {
      console.log(`${colors.red}❌ PM2 is not installed. Install it with: npm install -g pm2${colors.reset}`);
      resolve(false);
      return;
    }
    
    console.log(`${colors.cyan}🚀 Starting server with PM2...${colors.reset}`);
    console.log(`${colors.dim}   Host: ${host}:${port}${colors.reset}`);
    
    // Create logs directory if needed
    const logsDir = join(__dirname, 'logs');
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    
    const pm2Process = spawn('pm2', ['start', 'ecosystem.config.cjs'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });
    
    pm2Process.on('close', (code) => {
      if (code === 0) {
        console.log(`${colors.green}✅ Server started with PM2${colors.reset}`);
        console.log(`${colors.cyan}\n📊 Useful commands:${colors.reset}`);
        console.log(`   pm2 status           - Show status`);
        console.log(`   pm2 logs             - View logs`);
        console.log(`   pm2 monit            - Monitor`);
        console.log(`   pm2 stop all         - Stop all`);
        console.log(`   pm2 delete all       - Remove from PM2`);
        console.log(`${colors.cyan}\n🌐 Server URL: http://${host}:${port}${colors.reset}`);
        resolve(true);
      } else {
        console.log(`${colors.red}❌ Failed to start with PM2${colors.reset}`);
        resolve(false);
      }
    });
  });
}

// Start directly
function startDirect(port, host) {
  return new Promise((resolve) => {
    console.log(`${colors.cyan}🚀 Starting server directly...${colors.reset}`);
    console.log(`${colors.dim}   Host: ${host}:${port}${colors.reset}`);
    
    const env = {
      ...process.env,
      PORT: port.toString(),
      HOST: host,
      OLLAMA_HOST: config.ollama_url,
      WORKSPACE_DIR: __dirname,
      CHAT_ENABLED: config.chat_enabled === false ? 'false' : 'true'
    };
    
    const serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      env,
      stdio: 'inherit',
      detached: true
    });
    
    serverProcess.on('error', (err) => {
      console.log(`${colors.red}❌ Failed to start: ${err.message}${colors.reset}`);
      resolve(false);
    });
    
    // Give it a moment to start
    setTimeout(() => {
      console.log(`${colors.green}✅ Server started${colors.reset}`);
      console.log(`${colors.cyan}\n🌐 Server URL: http://${host}:${port}${colors.reset}`);
      console.log(`${colors.dim}\nNote: Server is running in background. Use 'stop' command to stop it.${colors.reset}`);
      resolve(true);
    }, 2000);
    
    // Don't wait for process exit - it's running in background
    serverProcess.unref();
  });
}

// Stop server
async function stopServer(options = {}) {
  const usePM2 = options.pm2 || config.mode === 'pm2';
  
  if (usePM2 && isPM2Running()) {
    console.log(`${colors.cyan}🛑 Stopping PM2 process...${colors.reset}`);
    
    try {
      execSync('pm2 stop ecosystem.config.cjs', { cwd: __dirname, stdio: 'inherit' });
      console.log(`${colors.green}✅ Server stopped${colors.reset}`);
      return true;
    } catch (e) {
      console.log(`${colors.red}❌ Failed to stop PM2 process${colors.reset}`);
      return false;
    }
  } else {
    // Try to find and kill direct node process
    const port = options.port || config.port;
    const processInfo = getProcessOnPort(port);
    
    if (processInfo) {
      console.log(`${colors.cyan}🛑 Stopping process on port ${port}...${colors.reset}`);
      if (killProcess(processInfo.pid, true)) {
        console.log(`${colors.green}✅ Server stopped${colors.reset}`);
        return true;
      } else {
        console.log(`${colors.red}❌ Could not stop server${colors.reset}`);
        return false;
      }
    } else {
      console.log(`${colors.yellow}⚠️  No server found on port ${port}${colors.reset}`);
      return false;
    }
  }
}

// Show status
async function showStatus() {
  const port = config.port;
  const host = config.host;
  
  console.log(`${colors.cyan}${colors.bright}📊 Server Status${colors.reset}\n`);
  console.log(`${colors.white}Configuration:${colors.reset}`);
  console.log(`  Host: ${host}`);
  console.log(`  Port: ${port}`);
  console.log(`  Mode: ${config.mode}`);
  console.log(`  Ollama: ${config.ollama_url}\n`);
  
  const portInUse = await isPortInUse(port);
  
  if (portInUse) {
    const processInfo = getProcessOnPort(port);
    console.log(`${colors.green}● Server is running${colors.reset}`);
    if (processInfo) {
      console.log(`  Process: ${processInfo.name} (PID: ${processInfo.pid})`);
    }
    console.log(`  URL: http://${host}:${port}`);
    
    if (isPM2Running()) {
      console.log(`  Managed by: PM2`);
    } else {
      console.log(`  Managed by: Direct`);
    }
  } else {
    console.log(`${colors.red}● Server is not running${colors.reset}`);
  }
  
  if (isPM2Installed()) {
    console.log(`\n${colors.dim}PM2 Status:${colors.reset}`);
    try {
      execSync('pm2 list', { stdio: 'inherit' });
    } catch (e) {
      // Ignore
    }
  }
}

// Show logs
function showLogs(options = {}) {
  const usePM2 = options.pm2 || config.mode === 'pm2';
  
  if (usePM2 && isPM2Running()) {
    console.log(`${colors.cyan}📜 Showing PM2 logs (Ctrl+C to exit)...${colors.reset}\n`);
    const logsProcess = spawn('pm2', ['logs', 'terminal-web-ui'], {
      stdio: 'inherit',
      shell: true
    });
    
    logsProcess.on('close', () => {
      process.exit(0);
    });
  } else {
    console.log(`${colors.yellow}⚠️  Logs only available when using PM2${colors.reset}`);
    console.log(`${colors.dim}   Start with PM2: node launcher-cli.js start --pm2${colors.reset}`);
  }
}

// Interactive mode
async function interactiveMode() {
  printBanner();
  
  const rl = createRL();
  
  console.log(`${colors.cyan}Choose launch mode:${colors.reset}\n`);
  console.log(`  ${colors.green}1${colors.reset}) Direct Node.js (simple, no dependencies)`);
  console.log(`  ${colors.green}2${colors.reset}) PM2 (process management, auto-restart, logs)\n`);
  
  const choice = await ask(rl, `${colors.cyan}Enter choice (1 or 2): ${colors.reset}`);
  
  if (choice === '2') {
    if (!isPM2Installed()) {
      console.log(`${colors.yellow}⚠️  PM2 is not installed${colors.reset}`);
      const install = await ask(rl, `${colors.cyan}Install PM2 now? [Y/n]: ${colors.reset}`);
      
      if (install.toLowerCase() !== 'n') {
        console.log(`${colors.cyan}📦 Installing PM2...${colors.reset}`);
        try {
          execSync('npm install -g pm2', { stdio: 'inherit' });
          console.log(`${colors.green}✅ PM2 installed${colors.reset}`);
        } catch (e) {
          console.log(`${colors.red}❌ Failed to install PM2${colors.reset}`);
          rl.close();
          return;
        }
      } else {
        console.log(`${colors.yellow}⚠️  Falling back to direct mode${colors.reset}`);
      }
    }
  }
  
  // Ask for port
  const portInput = await ask(rl, `${colors.cyan}Port (default: ${config.port}): ${colors.reset}`);
  const port = parseInt(portInput) || config.port;
  
  // Ask for network mode
  console.log(`\n${colors.cyan}Choose access mode:${colors.reset}\n`);
  console.log(`  ${colors.green}1${colors.reset}) Local only (localhost) - Most secure, only this computer`);
  console.log(`  ${colors.green}2${colors.reset}) Network (0.0.0.0) - Accessible from other devices\n`);
  
  const networkChoice = await ask(rl, `${colors.cyan}Enter choice (1 or 2, default: ${config.host === '0.0.0.0' ? '2' : '1'}): ${colors.reset}`);
  const host = (networkChoice === '2' || (!networkChoice && config.host === '0.0.0.0')) ? '0.0.0.0' : 'localhost';
  
  if (host === '0.0.0.0') {
    console.log(`\n${colors.yellow}⚠️  Network mode enabled - Server will be accessible from other devices${colors.reset}`);
    console.log(`${colors.dim}   Make sure your firewall allows port ${port}${colors.reset}\n`);
  }

  rl.close();

  const mode = choice === '2' ? 'pm2' : 'direct';

  console.log();
  await startServer({ port, host, [mode]: true });
}

// Main function
async function main() {
  loadConfig();
  
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Parse options
  const options = {
    port: config.port,
    host: config.host,
    pm2: false,
    direct: false,
    force: false
  };
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      options.port = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--host' && args[i + 1]) {
      options.host = args[i + 1];
      i++;
    } else if (arg === '--local') {
      options.host = 'localhost';
    } else if (arg === '--network') {
      options.host = '0.0.0.0';
    } else if (arg === '--pm2') {
      options.pm2 = true;
    } else if (arg === '--direct') {
      options.direct = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      printBanner();
      printHelp();
      return;
    }
  }
  
  switch (command) {
    case 'start':
      printBanner();
      await startServer(options);
      break;
      
    case 'stop':
      await stopServer(options);
      break;
      
    case 'restart':
      await stopServer(options);
      await new Promise(resolve => setTimeout(resolve, 1000));
      printBanner();
      await startServer(options);
      break;
      
    case 'status':
      await showStatus();
      break;
      
    case 'logs':
      showLogs(options);
      break;
      
    case 'interactive':
    case undefined:
    case '':
      await interactiveMode();
      break;
      
    default:
      printBanner();
      console.log(`${colors.red}Unknown command: ${command}${colors.reset}\n`);
      printHelp();
      process.exit(1);
  }
}

// Run main
main().catch(err => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
