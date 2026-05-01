#!/usr/bin/env node

/**
 * Web Terminal Launcher - TUI (Terminal User Interface)
 *
 * A stable, feature-rich blessed-based CLI launcher for the Web Terminal project.
 * Provides a dashboard with server controls, port status, live logs,
 * settings editor, and quick-start guide — matching the Python launcher features.
 */

import blessed from 'blessed';
import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';

// ── Config ──────────────────────────────────────────────────────────
const __dirname = import.meta.dirname;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 3456,
  ollama_url: 'http://localhost:11434',
  mode: 'local',
  chat_enabled: true
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {
    // ignore parse errors
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (e) {
    // ignore write errors
  }
}

let config = loadConfig();

// ── Port Helpers ───────────────────────────────────────────────────
function isPortInUse(port) {
  return new Promise((resolve) => {
    const tryConnect = (host) => {
      const socket = new net.Socket();
      socket.setTimeout(1500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        if (host === 'localhost') {
          tryConnect('127.0.0.1');
        } else {
          resolve(false);
        }
      });
      socket.once('timeout', () => {
        socket.destroy();
        if (host === 'localhost') {
          tryConnect('127.0.0.1');
        } else {
          resolve(false);
        }
      });
      socket.connect(port, host);
    };
    tryConnect('localhost');
  });
}

function getProcessOnPort(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const lines = stdout.trim().split(/\r?\n/);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1];
          exec(`tasklist /FI "PID eq ${pid}" /NH`, (err2, stdout2) => {
            if (err2 || !stdout2) return resolve({ pid, name: 'Unknown' });
            const name = stdout2.trim().split(/\s+/)[0] || 'Unknown';
            resolve({ pid, name });
          });
          return;
        }
      }
      resolve(null);
    });
  });
}

function killProcessOnPort(port) {
  return new Promise(async (resolve) => {
    const proc = await getProcessOnPort(port);
    if (!proc) return resolve(false);
    exec(`taskkill /F /PID ${proc.pid}`, (err) => resolve(!err));
  });
}

// ── State ───────────────────────────────────────────────────────────
let serverProcess = null;
let isRunning = false;
let autoRefreshInterval = null;

// ── UI Helpers ─────────────────────────────────────────────────────

/** Prompt user for a text value using blessed.textbox */
function promptValue(label, current) {
  return new Promise((resolve) => {
    const box = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 8,
      label: ` ${label} `,
      border: 'line',
      tags: true,
      style: {
        border: { fg: 'yellow' },
        fg: 'white',
        bg: 'black'
      }
    });

    box.setContent(`\n  {yellow-fg}${label}{/yellow-fg}\n  (current: {cyan-fg}${current}{/cyan-fg})`);

    const textbox = blessed.textbox({
      parent: box,
      top: 4,
      left: 2,
      width: '100%-4',
      height: 3,
      inputOnFocus: true,
      value: String(current),
      keys: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        fg: 'white',
        focus: { border: { fg: 'green' } }
      }
    });

    textbox.focus();
    screen.render();

    const cleanup = () => {
      box.detach();
      screen.render();
    };

    textbox.on('submit', (value) => {
      cleanup();
      resolve(value || '');
    });

    textbox.on('cancel', () => {
      cleanup();
      resolve(null);
    });

    textbox.key(['escape'], () => {
      cleanup();
      resolve(null);
    });
  });
}

/** Show a Yes/No confirmation dialog using blessed.list */
function confirmDialog(text) {
  return new Promise((resolve) => {
    const box = blessed.list({
      parent: screen,
      border: 'line',
      height: 8,
      width: 60,
      top: 'center',
      left: 'center',
      label: ' Confirm ',
      tags: true,
      items: ['Yes', 'No'],
      keys: true,
      vi: true,
      mouse: true,
      style: {
        border: { fg: 'red' },
        fg: 'white',
        bg: 'black',
        selected: { bg: 'green', fg: 'black', bold: true },
        item: { fg: 'white' }
      }
    });
    box.setContent(` {center}${text}{/center}`);
    box.focus();
    screen.render();
    box.once('select', (item, index) => {
      box.detach();
      menuBox.focus();
      screen.render();
      resolve(index === 0);
    });
  });
}

/** Show a simple message dialog */
function showMessage(text) {
  const box = blessed.message({
    parent: screen,
    border: 'line',
    height: 7,
    width: 60,
    top: 'center',
    left: 'center',
    label: ' Info ',
    tags: true,
    style: {
      border: { fg: 'cyan' },
      fg: 'white',
      bg: 'black'
    }
  });
  box.display(text, 3, () => {
    box.detach();
    menuBox.focus();
    screen.render();
  });
}

/** Show settings menu and return selected index */
function showSettingsMenu() {
  return new Promise((resolve) => {
    const settingsList = blessed.list({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 66,
      height: 14,
      label: ' Edit Settings ',
      border: 'line',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      items: [
        `Change Host   (current: {cyan-fg}${config.host}{/cyan-fg})`,
        `Change Port   (current: {cyan-fg}${config.port}{/cyan-fg})`,
        `Change Ollama (current: {cyan-fg}${config.ollama_url}{/cyan-fg})`,
        `Change Mode   (current: {cyan-fg}${config.mode}{/cyan-fg})`,
        `Toggle Chat   (current: {cyan-fg}${config.chat_enabled ? 'enabled' : 'disabled'}{/cyan-fg})`,
        '',
        '{green-fg}Save & Back to Menu{/green-fg}',
        '{red-fg}Discard & Back to Menu{/red-fg}'
      ],
      style: {
        border: { fg: 'yellow' },
        selected: { bg: 'yellow', fg: 'black', bold: true },
        item: { fg: 'white' }
      }
    });

    settingsList.focus();
    screen.render();

    settingsList.on('select', (item, index) => {
      settingsList.detach();
      screen.render();
      resolve(index);
    });

    settingsList.key(['escape'], () => {
      settingsList.detach();
      screen.render();
      resolve(6); // treat as discard
    });
  });
}

// ── Screen & Layout ─────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: 'Web Terminal Launcher',
  cursor: { artificial: true, shape: 'block', blink: true }
});

// Title bar
const titleBox = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  align: 'center',
  valign: 'middle',
  content: '{bold}🖥️  Web Terminal Launcher{/bold}\nNode.js TUI Dashboard',
  border: { type: 'line' },
  style: { border: { fg: 'cyan' }, fg: 'white', bg: 'black' }
});

// Status box
const statusBox = blessed.box({
  parent: screen,
  top: 3,
  left: 0,
  width: '50%',
  height: 5,
  tags: true,
  label: ' {bold}📊 Status{/bold} ',
  border: { type: 'line' },
  style: { border: { fg: 'blue' }, fg: 'white', bg: 'black' }
});

// Config box
const configBox = blessed.box({
  parent: screen,
  top: 3,
  left: '50%',
  width: '50%',
  height: 5,
  tags: true,
  label: ' {bold}⚙️  Config{/bold} ',
  border: { type: 'line' },
  style: { border: { fg: 'blue' }, fg: 'white', bg: 'black' }
});

// Port Status box
const portBox = blessed.box({
  parent: screen,
  top: 8,
  left: 0,
  width: '100%',
  height: 4,
  tags: true,
  label: ' {bold}🔌 Port Status{/bold} ',
  border: { type: 'line' },
  style: { border: { fg: 'yellow' }, fg: 'white', bg: 'black' }
});

// Menu list
const menuBox = blessed.list({
  parent: screen,
  top: 12,
  left: 0,
  width: '35%',
  height: '100%-15',
  tags: true,
  label: ' {bold}🧭 Menu{/bold} ',
  border: { type: 'line' },
  style: {
    border: { fg: 'green' },
    fg: 'white',
    bg: 'black',
    selected: { fg: 'black', bg: 'green', bold: true },
    item: { fg: 'white' }
  },
  keys: true,
  vi: true,
  mouse: true,
  scrollable: true,
  alwaysScroll: true,
  items: [
    '▶  Start Server',
    '⏹  Stop Server',
    '⚙️   Edit Settings',
    '🔍  Check Port',
    '💀  Kill Process',
    '🌐  Open Browser',
    '📋  View Full Logs',
    '❌  Exit'
  ]
});

// Quick Guide box
const guideBox = blessed.box({
  parent: screen,
  top: 12,
  left: '35%',
  width: '30%',
  height: '100%-15',
  tags: true,
  label: ' {bold}📖 Quick Start{/bold} ',
  border: { type: 'line' },
  style: { border: { fg: 'magenta' }, fg: 'white', bg: 'black' },
  content:
    ' 1. Select {bold}Start Server{/bold}\n' +
    ' 2. Wait for status: {green-fg}● Running{/green-fg}\n' +
    ' 3. Open browser at shown URL\n' +
    ' 4. Login with default creds:\n' +
    '    Email: admin@mail.com\n' +
    '    Password: admin123'
});

// Log box (blessed.log auto-scrolls)
const logBox = blessed.log({
  parent: screen,
  top: 12,
  left: '65%',
  width: '35%',
  height: '100%-15',
  tags: true,
  label: ' {bold}📋 Logs{/bold} ',
  border: { type: 'line' },
  style: { border: { fg: 'cyan' }, fg: 'white', bg: 'black' },
  scrollable: true,
  scrollbar: { ch: '│', style: { fg: 'cyan' } }
});

// Help bar
const helpBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  align: 'center',
  valign: 'middle',
  content: '↑/↓ Navigate | Enter Select | S Start/Stop | C Check | K Kill | O Open | R Refresh | Q Quit',
  border: { type: 'line' },
  style: { border: { fg: 'white' }, fg: 'white', bg: 'black' }
});

// ── Core Functions ──────────────────────────────────────────────────

function addLog(msg) {
  const lines = msg.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      // Truncate very long lines to keep TUI clean
      logBox.log(trimmed.substring(0, 250));
    }
  }
  screen.render();
}

async function updateStatus() {
  const healthHost = config.host === '0.0.0.0' ? 'localhost' : config.host;

  // Check port usage first to avoid race with a shutting-down server
  const inUse = await isPortInUse(config.port);

  const isHealthy = inUse
    ? await new Promise((resolve) => {
        const req = http.get(`http://${healthHost}:${config.port}/api/health`, { timeout: 2000 }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      })
    : false;

  isRunning = isHealthy && inUse;

  const statusText = isRunning
    ? '{green-fg}● Running{/green-fg}'
    : '{red-fg}● Stopped{/red-fg}';
  const urlText = isRunning
    ? `http://${healthHost}:${config.port}`
    : 'Not available';

  statusBox.setContent(
    ` Status: ${statusText}\n` +
    ` URL:    {cyan-fg}${urlText}{/cyan-fg}\n` +
    ` Mode:   ${config.mode === 'network' ? '🌐 Network' : '🖥️  Local only'}`
  );

  configBox.setContent(
    ` Host:   {cyan-fg}${config.host}{/cyan-fg}\n` +
    ` Port:   {cyan-fg}${config.port}{/cyan-fg}\n` +
    ` Ollama: {cyan-fg}${config.ollama_url}{/cyan-fg}`
  );

  // Port status
  if (inUse) {
    const proc = await getProcessOnPort(config.port);
    const procText = proc ? ` (${proc.name} PID:${proc.pid})` : '';
    if (isRunning) {
      portBox.setContent(
        ` Port: {yellow-fg}${config.port}{/yellow-fg}   {green-fg}● Active (this server){/green-fg}${procText}\n` +
        ` {gray-fg}Server is listening on this port.{/gray-fg}`
      );
    } else {
      portBox.setContent(
        ` Port: {yellow-fg}${config.port}{/yellow-fg}   {red-fg}● In Use{/red-fg}${procText}\n` +
        ` {gray-fg}Another process is using this port.{/gray-fg}`
      );
    }
  } else {
    portBox.setContent(
      ` Port: {yellow-fg}${config.port}{/yellow-fg}   {green-fg}● Free{/green-fg}\n` +
      ` {gray-fg}Port is available for use.{/gray-fg}`
    );
  }

  // Update menu item appearance
  menuBox.setItem(0, isRunning ? '{gray-fg}▶  Start Server{/gray-fg}' : '▶  Start Server');
  menuBox.setItem(1, isRunning ? '⏹  Stop Server' : '{gray-fg}⏹  Stop Server{/gray-fg}');

  screen.render();
}

async function startServer() {
  if (isRunning) {
    addLog('Server is already running.');
    return;
  }

  // Check port
  const inUse = await isPortInUse(config.port);
  if (inUse) {
    const proc = await getProcessOnPort(config.port);
    const procName = proc ? `${proc.name} (PID:${proc.pid})` : 'Unknown process';
    const yes = await confirmDialog(`Port ${config.port} is in use by ${procName}. Kill it and start server?`);
    if (yes) {
      addLog(`Killing process on port ${config.port}...`);
      const killed = await killProcessOnPort(config.port);
      if (!killed) {
        showMessage('Failed to kill process. Start cancelled.');
        return;
      }
      await new Promise((r) => setTimeout(r, 800));
    } else {
      addLog('Start cancelled by user.');
      return;
    }
  }

  doStartServer();
}

function doStartServer() {
  addLog('Starting server...');

  const args = [path.join(__dirname, 'server.js')];
  const env = {
    ...process.env,
    PORT: config.port,
    HOST: config.host,
    OLLAMA_URL: config.ollama_url,
    CHAT_ENABLED: config.chat_enabled === false ? 'false' : 'true'
  };

  const proc = spawn('node', args, {
    cwd: __dirname,
    env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess = proc;

  proc.stdout.on('data', (data) => addLog(data.toString()));
  proc.stderr.on('data', (data) => addLog(`{red-fg}[stderr]{/red-fg} ${data.toString()}`));

  proc.on('error', (err) => {
    addLog(`{red-fg}Server spawn error: ${err.message}{/red-fg}`);
    if (serverProcess === proc) {
      isRunning = false;
      serverProcess = null;
      updateStatus();
    }
  });

  proc.on('close', (code) => {
    addLog(`Server process exited with code ${code}`);
    if (serverProcess === proc) {
      isRunning = false;
      serverProcess = null;
      updateStatus();
    }
  });

  proc.unref();

  // Verify after a short delay
  setTimeout(async () => {
    await updateStatus();
    if (isRunning) {
      addLog('{green-fg}Server started successfully!{/green-fg}');
    } else {
      addLog('{yellow-fg}Server may still be starting... check again shortly.{/yellow-fg}');
    }
  }, 2500);
}

async function stopServer() {
  if (!serverProcess) {
    addLog('No tracked process. Checking port...');
    const inUse = await isPortInUse(config.port);
    if (inUse) {
      const yes = await confirmDialog(`No tracked process, but port ${config.port} is in use. Kill it?`);
      if (yes) {
        const killed = await killProcessOnPort(config.port);
        addLog(killed ? 'Process killed.' : 'Failed to kill process.');
      }
    } else {
      addLog('Port is already free.');
    }
    await updateStatus();
    return;
  }

  addLog('Stopping server...');

  const pid = serverProcess.pid;

  try {
    serverProcess.kill('SIGTERM');
  } catch (e) {
    // Fallback for Windows
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e2) {
      addLog('Using taskkill fallback...');
      exec(`taskkill /F /T /PID ${pid}`, () => {});
    }
  }

  // Poll until the port is actually freed (up to 5 seconds)
  let attempts = 0;
  const maxAttempts = 25; // 25 * 200ms = 5s
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 200));
    const stillInUse = await isPortInUse(config.port);
    if (!stillInUse) {
      addLog('Server stopped. Port freed.');
      break;
    }
    attempts++;
  }

  if (attempts >= maxAttempts) {
    addLog('Warning: port may still be in use.');
  }

  serverProcess = null;
  isRunning = false;
  await updateStatus();
}

async function editSettings() {
  const tempConfig = { ...config };
  let running = true;

  while (running) {
    const index = await showSettingsMenu();

    switch (index) {
      case 0: {
        const host = await promptValue('Host Address', tempConfig.host);
        if (host !== null && host.trim()) tempConfig.host = host.trim();
        break;
      }
      case 1: {
        const port = await promptValue('Port Number', tempConfig.port);
        if (port !== null && port.trim()) {
          const p = parseInt(port.trim(), 10);
          if (p > 0 && p <= 65535) tempConfig.port = p;
        }
        break;
      }
      case 2: {
        const ollama = await promptValue('Ollama URL', tempConfig.ollama_url);
        if (ollama !== null && ollama.trim()) tempConfig.ollama_url = ollama.trim();
        break;
      }
      case 3: {
        const mode = await promptValue('Mode (local or network)', tempConfig.mode);
        if (mode !== null && mode.trim()) {
          const m = mode.trim().toLowerCase();
          if (m === 'network' || m === 'local') tempConfig.mode = m;
        }
        break;
      }
      case 4: {
        const chatVal = await promptValue('Chat enabled (true or false)', tempConfig.chat_enabled ? 'true' : 'false');
        if (chatVal !== null && chatVal.trim()) {
          const v = chatVal.trim().toLowerCase();
          tempConfig.chat_enabled = (v === 'true' || v === 'yes' || v === '1' || v === 'on');
        }
        break;
      }
      case 6: {
        Object.assign(config, tempConfig);
        saveConfig(config);
        addLog('Settings saved.');
        updateStatus();
        running = false;
        break;
      }
      case 7:
      default: {
        addLog('Settings changes discarded.');
        running = false;
        break;
      }
    }
  }

  menuBox.focus();
  screen.render();
}

async function checkPort() {
  addLog(`Checking port ${config.port}...`);
  await updateStatus();
}

async function killPort() {
  const proc = await getProcessOnPort(config.port);
  if (!proc) {
    showMessage(`No process found on port ${config.port}.`);
    addLog(`Port ${config.port} is free.`);
    return;
  }

  const yes = await confirmDialog(`Kill ${proc.name} (PID:${proc.pid}) on port ${config.port}?`);
  if (yes) {
    addLog(`Killing ${proc.name} (PID:${proc.pid})...`);
    exec(`taskkill /F /PID ${proc.pid}`, (err) => {
      if (!err) {
        addLog(`{green-fg}Killed ${proc.name} (PID:${proc.pid}).{/green-fg}`);
      } else {
        addLog(`{red-fg}Failed to kill process: ${err?.message || 'unknown error'}{/red-fg}`);
      }
      updateStatus();
    });
  } else {
    addLog('Kill cancelled.');
  }
}

function openBrowser() {
  const host = config.host === '0.0.0.0' ? 'localhost' : config.host;
  const url = `http://${host}:${config.port}`;
  addLog(`Opening browser: ${url}`);
  exec(`start "" "${url}"`, (err) => {
    if (err) addLog(`{red-fg}Failed to open browser: ${err.message}{/red-fg}`);
  });
}

function viewLogs() {
  logBox.focus();
  screen.render();
}

function exitApp() {
  cleanup();
  process.exit(0);
}

function cleanup() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch (e) {
      exec(`taskkill /F /PID ${serverProcess.pid}`, () => {});
    }
    serverProcess = null;
  }
  try {
    screen.destroy();
  } catch (e) {
    // ignore
  }
}

// ── Event Handlers ──────────────────────────────────────────────────

menuBox.on('select', (item, index) => {
  switch (index) {
    case 0: startServer(); break;
    case 1: stopServer(); break;
    case 2: editSettings(); break;
    case 3: checkPort(); break;
    case 4: killPort(); break;
    case 5: openBrowser(); break;
    case 6: viewLogs(); break;
    case 7: exitApp(); break;
  }
});

screen.key(['q', 'Q', 'C-c'], () => exitApp());

screen.key(['s', 'S'], () => {
  if (isRunning) stopServer();
  else startServer();
});

screen.key(['r', 'R'], () => updateStatus());

screen.key(['c', 'C'], () => checkPort());

screen.key(['k', 'K'], () => killPort());

screen.key(['o', 'O'], () => openBrowser());

screen.key(['tab'], () => {
  if (screen.focused === menuBox) logBox.focus();
  else menuBox.focus();
  screen.render();
});

screen.on('resize', () => screen.render());

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// ── Init ────────────────────────────────────────────────────────────
addLog('Web Terminal Launcher initialized.');
addLog(`Config: ${config.host}:${config.port} (${config.mode})`);

updateStatus().then(() => {
  menuBox.focus();
  screen.render();
});

autoRefreshInterval = setInterval(() => {
  updateStatus();
}, 3000);
