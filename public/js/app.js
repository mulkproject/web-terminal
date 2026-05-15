    import { Terminal } from 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm';
    import { FitAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm';

    // State
    let ws = null;
    let terminals = new Map(); // Map of terminalId -> { terminal, fitAddon, element, cwd, name }
    let activeTerminalId = null;
    let currentPath = null;
    let authToken = localStorage.getItem('terminal_auth_token');
    let currentUser = null;
    let terminalCounter = 0;
    let terminalSystemInitialized = false;

    // Terminal Shell Selection State
    let availableShells = [];
    let selectedShell = localStorage.getItem('terminal_selected_shell') || null;
    let defaultShell = null;

    // DOM Elements
    const authScreen = document.getElementById('authScreen');
    const appContainer = document.getElementById('appContainer');
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const loginBtn = document.getElementById('loginBtn');
    const authError = document.getElementById('authError');
    const logoutBtn = document.getElementById('logoutBtn');
    const resetPasswordBtn = document.getElementById('resetPasswordBtn');
    const resetModal = document.getElementById('resetModal');
    const newPasswordInput = document.getElementById('newPasswordInput');
    const toggleNewPasswordBtn = document.getElementById('toggleNewPassword');
    const confirmResetBtn = document.getElementById('confirmResetBtn');
    const autoGenBtn = document.getElementById('autoGenBtn');
    const cancelResetBtn = document.getElementById('cancelResetBtn');
    const resetSuccess = document.getElementById('resetSuccess');
    const generatedPasswordContainer = document.getElementById('generatedPasswordContainer');
    const changeEmailBtn = document.getElementById('changeEmailBtn');
    const changeEmailModal = document.getElementById('changeEmailModal');
    const newEmailInput = document.getElementById('newEmailInput');
    const confirmChangeEmailBtn = document.getElementById('confirmChangeEmailBtn');
    const cancelChangeEmailBtn = document.getElementById('cancelChangeEmailBtn');
    const changeEmailSuccess = document.getElementById('changeEmailSuccess');

    const currentPathEl = document.getElementById('currentPath');
    const copyPathBtn = document.getElementById('copyPathBtn');
    const directoryListEl = document.getElementById('directoryList');
    const openTerminalBtn = document.getElementById('openTerminalBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const terminalInfo = document.getElementById('terminalInfo');
    const newTerminalBtn = document.getElementById('newTerminalBtn');
    const selectShellBtn = document.getElementById('selectShellBtn');
    const clearTerminalBtn = document.getElementById('clearTerminalBtn');
    const savedCommandsBtn = document.getElementById('savedCommandsBtn');
    const savedCommandsModal = document.getElementById('savedCommandsModal');
    const savedCommandsList = document.getElementById('savedCommandsList');
    const newCommandName = document.getElementById('newCommandName');
    const newCommandText = document.getElementById('newCommandText');
    const addCommandBtn = document.getElementById('addCommandBtn');
    const cancelSavedCommandsBtn = document.getElementById('cancelSavedCommandsBtn');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const terminalStatus = document.getElementById('terminalStatus');

    // TTS Elements
    const ttsPlayer = document.getElementById('ttsPlayer');
    let currentTtsAudio = null;
    let playingTtsBtn = null;

    // Mobile UI Elements
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    console.log('[Init] Mobile elements - sidebar:', !!sidebar, 'toggle:', !!sidebarToggle, 'overlay:', !!sidebarOverlay);
    
    const pwaInstallBtn = document.getElementById('pwaInstallBtn');
    const ptrIndicator = document.getElementById('ptrIndicator');
    const mainContent = document.querySelector('.main-content');

    // View Toggle Elements
    const viewTerminalBtn = document.getElementById('viewTerminalBtn');
    const viewChatBtn = document.getElementById('viewChatBtn');
    const terminalView = document.getElementById('terminalView');
    const chatPage = document.getElementById('chatPage');

    // Chat Elements (Multi-Session)
    const chatTabs = document.getElementById('chatTabs');
    const newChatSessionBtn = document.getElementById('newChatSessionBtn');
    const startNewChatBtn = document.getElementById('startNewChatBtn');
    const emptyChatState = document.getElementById('emptyChatState');
    const chatActiveUi = document.getElementById('chatActiveUi');
    const chatMessagesContainer = document.getElementById('chatMessagesContainer');
    const chatModelSelect = document.getElementById('chatModelSelect');
    const chatProviderSelect = document.getElementById('chatProviderSelect');
        const chatStatusBadge = document.getElementById('chatStatusBadge');
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const renameChatSessionBtn = document.getElementById('renameChatSessionBtn');
    const clearChatSessionBtn = document.getElementById('clearChatSessionBtn');
    const deleteChatSessionBtn = document.getElementById('deleteChatSessionBtn');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const chatMoreBtn = document.getElementById('chatMoreBtn');
    const chatMoreGroup = document.getElementById('chatMoreGroup');

    // Chat feature toggle state
    let chatEnabled = true;

    // Image Upload Elements
    const uploadImageBtn = document.getElementById('uploadImageBtn');
    const imageUploadInput = document.getElementById('imageUploadInput');
    const imageUploadPreview = document.getElementById('imageUploadPreview');
    const imagePreview = document.getElementById('imagePreview');
    const imagePreviewName = document.getElementById('imagePreviewName');
    const removeImageBtn = document.getElementById('removeImageBtn');
    let pendingImageFile = null; // Store uploaded image file
    let pendingImagePath = null; // Store saved image path

    // Chat State (Multi-Session)
    let chatSessions = new Map(); // sessionId -> { id, name, messages, model, initialized, element }
    let activeChatSessionId = null;
    let chatSessionCounter = 0;
    let chatSessionsLoading = false; // Prevent concurrent load calls
    let agentWorkingCount = 0; // Track concurrent agent work for indicator
    let creatingSession = false; // Prevent double session creation
    let availableModels = []; // Available LLM models from server
    let availableProviders = []; // Available LLM providers from server
    let pendingSessionInit = null; // Track session waiting for WebSocket to initialize

    // Password Toggle
    togglePasswordBtn.addEventListener('click', () => {
      const type = passwordInput.type === 'password' ? 'text' : 'password';
      passwordInput.type = type;
      togglePasswordBtn.textContent = type === 'password' ? '👁️' : '🙈';
    });

    toggleNewPasswordBtn.addEventListener('click', () => {
      const type = newPasswordInput.type === 'password' ? 'text' : 'password';
      newPasswordInput.type = type;
      toggleNewPasswordBtn.textContent = type === 'password' ? '👁️' : '🙈';
    });

    // Login Form
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = emailInput.value;
      const password = passwordInput.value;

      authError.classList.remove('show');
      loginBtn.disabled = true;
      loginBtn.textContent = 'Signing in...';

      // Send auth via WebSocket
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'auth', email, password }));
      } else {
        authError.textContent = 'Connection error. Please try again.';
        authError.classList.add('show');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
      }
    });

    // Wake Lock API - keep screen on when terminal is active
    let wakeLock = null;

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator && !wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('Wake Lock acquired');

          wakeLock.addEventListener('release', () => {
            console.log('Wake Lock released');
            wakeLock = null;
          });
        }
      } catch (err) {
        console.warn('Wake Lock not available:', err.message);
      }
    }

    async function releaseWakeLock() {
      if (wakeLock) {
        try {
          await wakeLock.release();
        } catch (err) {
          console.warn('Error releasing Wake Lock:', err.message);
        }
        wakeLock = null;
      }
    }

    // Re-acquire wake lock when page becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && activeTerminalId) {
        requestWakeLock();
      }
    });

    // Initialize WebSocket
    let connecting = false;
    let reconnectTimeout = null;
    let processingExistingTerminals = false;
    let pendingTerminalRecreationTimeouts = [];

    function connect() {
      if (connecting) return;
      // Cancel any pending reconnect timeout before starting a new connection
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      connecting = true;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}`);

      ws.onopen = () => {
        connecting = false;
        // Cancel reconnect timeout since we're now connected
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        console.log('WebSocket connected');
        updateStatus(true);

        // Start ping interval to keep connection alive (even in background)
        startPingInterval();

        // Try to authenticate with stored token
        if (authToken) {
          ws.send(JSON.stringify({ type: 'auth_token', token: authToken }));
        }

        // Register for background sync after connection
        registerBackgroundSync();

        // Process any pending session initialization
        if (pendingSessionInit) {
          console.log('Processing pending session initialization:', pendingSessionInit.sessionId);
          const { sessionId, workingDirectory } = pendingSessionInit;
          pendingSessionInit = null;
          setTimeout(() => initializeChatSession(sessionId, workingDirectory), 100);
        }

        // Also check if active session needs initialization (e.g., after page reload)
        if (activeChatSessionId) {
          const session = chatSessions.get(activeChatSessionId);
          if (session && !session.initialized && !session.initializing && session.serverSessionId) {
            console.log('Auto-initializing active session after reconnect:', activeChatSessionId);
            setTimeout(() => initializeChatSession(activeChatSessionId), 200);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      const thisSocket = ws;
      ws.onclose = () => {
        // Only process close for the current active WebSocket instance.
        // If connect() was called again and replaced ws with a newer socket,
        // ignore this stale close event so we don't spawn extra reconnect timers.
        if (ws !== thisSocket) {
          console.log('Ignoring close event for stale WebSocket');
          return;
        }
        ws = null;
        connecting = false;
        console.log('WebSocket disconnected');
        updateStatus(false);
        resetAgentWorkingIndicator();
        // Clear any pending terminal recreation timeouts to avoid ghost tabs
        pendingTerminalRecreationTimeouts.forEach(t => clearTimeout(t));
        pendingTerminalRecreationTimeouts = [];
        // Schedule reconnect
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        // Don't set connecting = false here; let onclose handle it
        console.error('WebSocket error:', err);
        updateStatus(false);
      };
    }

    function updateStatus(connected) {
      if (connected) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected';
      } else {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Disconnected - Reconnecting...';
      }
    }

    async function fetchServerStatus() {
      try {
        const response = await fetch('/api/status', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (typeof data.chatEnabled === 'boolean') {
            chatEnabled = data.chatEnabled;
            updateChatFeatureVisibility();
          }
        }
      } catch (err) {
        console.error('Failed to fetch server status:', err);
      }
    }

    function updateChatFeatureVisibility() {
      if (chatEnabled) {
        viewChatBtn?.classList.remove('hidden');
        chatPage?.classList.remove('hidden');
      } else {
        viewChatBtn?.classList.add('hidden');
        chatPage?.classList.remove('show');
        chatPage?.classList.add('hidden');
        viewChatBtn?.classList.remove('active');
        terminalView?.classList.add('active');
        // Close any open chat panels
        hideSessionHistoryPanel();
      }
    }

    function handleMessage(data) {
      switch (data.type) {
        case 'auth_success':
          handleAuthSuccess(data);
          break;

        case 'auth_failed':
          handleAuthFailed(data.message);
          break;

        case 'logged_out':
          handleLogout();
          break;

        case 'browse_result':
          if (data.success) {
            renderDirectory(data);
          } else {
            showError('Failed to browse: ' + data.error);
          }
          break;

        case 'terminal_started':
          const termData = terminals.get(data.terminalId);
          if (termData) {
            termData.cwd = data.cwd;
            termData.isActive = true;
            // Update shell info if server returns it
            if (data.shell) {
              const shellConfig = availableShells.find(s => s.id === data.shell);
              if (shellConfig) {
                termData.shell = shellConfig.name;
              }
            }
            updateTerminalTab(data.terminalId, data.cwd);
            const shellName = termData.shell || 'Terminal';
            terminalInfo.textContent = `${shellName} - ${data.cwd}`;
            terminalStatus.textContent = `${shellName} active`;

            // Show reconnection message if applicable
            if (data.reconnected) {
              termData.terminal.writeln('\r\n\x1b[1;32m[Session restored - reconnected to existing terminal]\x1b[0m\r\n');
            }
          }
          openTerminalBtn.disabled = false;
          openTerminalBtn.textContent = '🖥️ Open Terminal Here';
          break;

        case 'terminal_output':
          {
            const t = terminals.get(data.terminalId);
            if (t?.terminal && data.data) {
              t.terminal.write(data.data);
              // Auto-scroll to bottom
              t.terminal.scrollToBottom();
            }
          }
          break;

        case 'terminal_exit':
          {
            const exitedTerm = terminals.get(data.terminalId);
            if (exitedTerm) {
              exitedTerm.isActive = false;
              terminalStatus.textContent = 'Terminal closed';
              exitedTerm.terminal.writeln('\r\n\x1b[1;33mTerminal session ended.\x1b[0m');
            }
          }
          break;

        case 'existing_terminals':
          // Guard against concurrent/race processing and duplicate terminal creation
          if (processingExistingTerminals) break;
          processingExistingTerminals = true;
          if (data.terminals?.length > 0) {
            // Cancel any pending recreation timeouts from a previous batch
            pendingTerminalRecreationTimeouts.forEach(t => clearTimeout(t));
            pendingTerminalRecreationTimeouts = [];
            // Only clear terminals that are NOT in the server's list (preserve truly new terminals)
            const serverTerminalIds = new Set(data.terminals.map(t => t.terminalId));
            terminals.forEach((t, id) => {
              if (!serverTerminalIds.has(id)) {
                t.terminal?.dispose();
                t.element?.remove();
                terminals.delete(id);
              }
            });
            if (terminals.size === 0) {
              activeTerminalId = null;
              terminalCounter = 0;
            }
            renderTabs();
            // Reconnect to each existing terminal with staggered delays
            data.terminals.forEach((t, index) => {
              if (terminals.has(t.terminalId)) return; // already connected
              const to = setTimeout(() => {
                // Re-verify before creating: socket must be open and tab must not exist yet
                if (ws?.readyState !== WebSocket.OPEN) return;
                if (terminals.has(t.terminalId)) return;
                createTerminal(t.cwd, t.terminalId);
              }, index * 100);
              pendingTerminalRecreationTimeouts.push(to);
            });
            // Hold the lock long enough for all staggered timeouts to fire
            const releaseDelay = Math.max(500, data.terminals.length * 100 + 500);
            setTimeout(() => { processingExistingTerminals = false; }, releaseDelay);
          } else {
            setTimeout(() => { processingExistingTerminals = false; }, 500);
          }
          break;

        case 'password_reset':
          handlePasswordResetSuccess(data);
          break;

        case 'chat_initialized':
        case 'chat_session_created':
        case 'chat_session_deleted':
        case 'chat_session_renamed':
        case 'chat_session_cleared':
        case 'chat_message':
        case 'chat_message_sent':
        case 'chat_error':
        case 'chat_cleared':
        case 'command_result':
        case 'permission_request':
        case 'user_input_request':
        case 'tool_start':
        case 'tool_progress':
        case 'tool_complete':
        case 'mode_changed':
        case 'chat_stream_delta':
        case 'chat_stream_complete':
        case 'chat_idle':
        case 'token_usage_update':
        case 'subagent_started':
        case 'subagent_completed':
          handleChatMessage(data);
          break;

        case 'error':
          console.error('Server error:', data.message);
          if (data.message?.includes('Not authenticated')) {
            handleLogout();
          }
          break;
      }
    }

    function handleAuthSuccess(data) {
      currentUser = data.user;
      authToken = data.token;
      localStorage.setItem('terminal_auth_token', authToken);

      // Show app
      authScreen.classList.remove('show');
      appContainer.classList.add('show');
      
      // Show sidebar toggle (for mobile/desktop)
      if (sidebarToggle) sidebarToggle.style.display = 'flex';

      // Update UI
      // (user e-mail is intentionally NOT displayed in the UI for privacy)

      // Initialize terminal system if not already
      if (!terminalSystemInitialized) {
        initTerminal();
        terminalSystemInitialized = true;
      }

      // Fetch available shells after successful auth
      fetchAvailableShells();

      // Fetch server config (including chat enabled status)
      fetchServerStatus();

      // If reconnecting, ask server for existing terminals first
      if (isReconnecting && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_terminals' }));
        isReconnecting = false;

        // Still restore directory
        const sessionData = restoreSessionState();
        if (sessionData?.currentPath) {
          browseDirectory(sessionData.currentPath);
        } else {
          browseDirectory();
        }
      } else {
        // Fresh start - load session from localStorage
        const sessionData = restoreSessionState();
        if (sessionData?.currentPath) {
          browseDirectory(sessionData.currentPath);

          if (sessionData.terminals?.length > 0) {
            setTimeout(() => {
              sessionData.terminals.forEach(t => {
                createTerminal(t.cwd);
              });
            }, 500);
          }
        } else {
          browseDirectory();
        }
      }

      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';

      console.log(`Authenticated as: ${data.user.email}`);

      // Restore active chat session after auth
      setTimeout(async () => {
        await restoreChatSessionAfterAuth();
      }, 100);
    }

    // Restore chat session after authentication
    async function restoreChatSessionAfterAuth() {
      try {
        // Load chat sessions from server
        if (chatSessions.size === 0) {
          await loadChatSessions();
        }

        // Restore active session if one was saved
        const savedActiveSessionId = restoreActiveChatSession();
        if (savedActiveSessionId && chatSessions.has(savedActiveSessionId)) {
          console.log(`Restoring active chat session: ${savedActiveSessionId}`);
          setActiveChatSession(savedActiveSessionId);
        }
      } catch (err) {
        console.error('Failed to restore chat session:', err);
      }
    }

    function handleAuthFailed(message) {
      authError.textContent = message || 'Authentication failed';
      authError.classList.add('show');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
      localStorage.removeItem('terminal_auth_token');
      // Ensure auth screen is visible
      authScreen.classList.add('show');
    }

    function handleLogout() {
      currentUser = null;
      authToken = null;
      localStorage.removeItem('terminal_auth_token');

      // Show auth screen
      authScreen.classList.add('show');
      appContainer.classList.remove('show');
      
      // Hide sidebar toggle and overlay
      if (sidebarToggle) sidebarToggle.style.display = 'none';
      if (sidebarOverlay) sidebarOverlay.classList.remove('show');
      if (sidebar) sidebar.classList.remove('show');

      // Reset form
      passwordInput.value = '';
      authError.classList.remove('show');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';

      // Kill all terminals
      terminals.forEach((t) => {
        t.terminal?.dispose();
      });
      terminals.clear();
      activeTerminalId = null;
      terminalCounter = 0;
      renderTabs();
      document.getElementById('noTerminalMsg')?.classList.remove('hidden');

      // Clear session state
      clearSessionState();

      // Clear active chat session
      saveActiveChatSession(null);
      activeChatSessionId = null;
      chatSessions.clear();
      pendingSessionInit = null;
    }

    // ==========================================
    // TERMINAL SHELL MANAGEMENT
    // ==========================================

    async function fetchAvailableShells() {
      try {
        const response = await fetch('/api/terminals/available', {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            availableShells = data.terminals;
            defaultShell = data.default;

            // If no shell selected yet, use default
            if (!selectedShell) {
              selectedShell = defaultShell;
              localStorage.setItem('terminal_selected_shell', selectedShell);
            }

            console.log('🖥️  Available shells:', availableShells.map(s => s.name).join(', '));
            return true;
          }
        }
      } catch (err) {
        console.error('Failed to fetch available shells:', err);
      }
      return false;
    }

    function showShellSelectorModal(onSelect) {
      // Remove existing modal
      const existingModal = document.getElementById('shellSelectorModal');
      if (existingModal) {
        existingModal.remove();
      }

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'shellSelectorModal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
      `;

      // Build shell options
      const shellOptions = availableShells.map(shell => {
        const isSelected = shell.id === selectedShell;
        const isRecommended = shell.recommended;
        return `
          <div class="shell-option ${isSelected ? 'selected' : ''}" data-shell="${shell.id}"
               style="padding: 16px; border: 2px solid ${isSelected ? 'var(--accent-primary)' : 'var(--bg-lighter)'};
                      border-radius: 8px; cursor: pointer; margin-bottom: 12px;
                      background: var(--bg-medium); transition: all 0.2s;
                      display: flex; align-items: center; gap: 12px;"
               onmouseover="this.style.borderColor='var(--accent-primary)'; this.style.background='var(--bg-lighter)'"
               onmouseout="this.style.borderColor='${isSelected ? 'var(--accent-primary)' : 'var(--bg-lighter)'}'; this.style.background='var(--bg-medium)'">
            <div style="font-size: 24px;">${shell.icon}</div>
            <div style="flex: 1;">
              <div style="font-weight: 600; color: var(--text-primary);">${shell.name} ${isRecommended ? '<span style="color: var(--accent-primary);">(Recommended)</span>' : ''}</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${shell.description}</div>
            </div>
            ${isSelected ? '<div style="color: var(--accent-primary);">✓</div>' : ''}
          </div>
        `;
      }).join('');

      modal.innerHTML = `
        <div style="background: var(--bg-dark); border-radius: 12px; padding: 24px; max-width: 500px; width: 100%; max-height: 80vh; overflow-y: auto;">
          <h3 style="margin: 0 0 8px 0; color: var(--text-primary);">Select Terminal</h3>
          <p style="margin: 0 0 20px 0; color: var(--text-muted); font-size: 14px;">Choose your preferred shell for this terminal session:</p>
          <div class="shell-options" style="margin-bottom: 20px;">${shellOptions}</div>
          <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="cancelShellSelect" style="padding: 10px 20px; border: 1px solid var(--bg-lighter);
                    background: transparent; color: var(--text-primary); border-radius: 6px; cursor: pointer;">Cancel</button>
            <button id="confirmShellSelect" style="padding: 10px 20px; border: none;
                    background: var(--accent-primary); color: #000; border-radius: 6px; cursor: pointer; font-weight: 500;">Open Terminal</button>
          </div>
        </div>
      `;

      // Handle shell selection
      let tempSelectedShell = selectedShell;

      modal.querySelectorAll('.shell-option').forEach(option => {
        option.addEventListener('click', () => {
          modal.querySelectorAll('.shell-option').forEach(opt => {
            opt.classList.remove('selected');
            opt.style.borderColor = 'var(--bg-lighter)';
            opt.querySelector('.checkmark')?.remove();
          });
          option.classList.add('selected');
          option.style.borderColor = 'var(--accent-primary)';
          tempSelectedShell = option.dataset.shell;

          // Add checkmark
          const checkmark = document.createElement('div');
          checkmark.className = 'checkmark';
          checkmark.style.cssText = 'color: var(--accent-primary);';
          checkmark.textContent = '✓';
          option.appendChild(checkmark);
        });
      });

      // Handle buttons
      modal.querySelector('#cancelShellSelect').addEventListener('click', () => {
        modal.remove();
        if (onSelect) onSelect(null);
      });

      modal.querySelector('#confirmShellSelect').addEventListener('click', () => {
        selectedShell = tempSelectedShell;
        localStorage.setItem('terminal_selected_shell', selectedShell);
        modal.remove();
        if (onSelect) onSelect(selectedShell);
      });

      // Close on backdrop click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
          if (onSelect) onSelect(null);
        }
      });

      document.body.appendChild(modal);
    }

    // Helper function to get shell icon based on shell name
    function getShellIcon(shellName) {
      if (!shellName) return '🖥️';
      const name = shellName.toLowerCase();
      if (name.includes('powershell') || name.includes('pwsh')) return '⚡';
      if (name.includes('cmd') || name.includes('command')) return '⌘';
      if (name.includes('bash')) return '🐚';
      if (name.includes('zsh')) return '💲';
      if (name.includes('fish')) return '🐟';
      if (name.includes('wsl')) return '⊞';
      if (name.includes('git')) return 'git';
      return '🖥️';
    }

    // ==========================================
    // SESSION PERSISTENCE
    // ==========================================

    const SESSION_KEY = 'terminal_session_state';
    const ACTIVE_CHAT_SESSION_KEY = 'active_chat_session_id';

    function saveSessionState() {
      const sessionData = {
        currentPath: currentPath,
        terminals: Array.from(terminals.entries()).map(([id, t]) => ({
          id,
          cwd: t.cwd,
          name: t.name
        })),
        timestamp: Date.now()
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    }

    function saveActiveChatSession(sessionId) {
      try {
        if (sessionId) {
          const session = chatSessions.get(sessionId);
          // Save serverSessionId if available (stable across refreshes),
          // otherwise fall back to the client-generated sessionId
          const stableId = session?.serverSessionId || sessionId;
          localStorage.setItem(ACTIVE_CHAT_SESSION_KEY, stableId);
          console.log('💾 Saved active chat session:', stableId, '(type:', session?.serverSessionId ? 'server' : 'client', ')');
        } else {
          localStorage.removeItem(ACTIVE_CHAT_SESSION_KEY);
        }
      } catch (err) {
        console.error('Failed to save active chat session:', err);
      }
    }

    function restoreActiveChatSession() {
      try {
        const savedId = localStorage.getItem(ACTIVE_CHAT_SESSION_KEY);
        if (!savedId) return null;

        // First try: direct client ID match (for sessions not yet confirmed by server)
        if (chatSessions.has(savedId)) {
          console.log('✅ Restored active session by client ID:', savedId);
          return savedId;
        }

        // Second try: match by serverSessionId (stable across page refreshes)
        for (const [clientId, session] of chatSessions) {
          if (session.serverSessionId === savedId) {
            console.log('✅ Restored active session by serverSessionId:', savedId, '-> clientId:', clientId);
            return clientId;
          }
        }

        console.log('⚠️ Saved active session ID not found in loaded sessions:', savedId);
        return null;
      } catch (err) {
        console.error('Failed to restore active chat session:', err);
        return null;
      }
    }

    function restoreSessionState() {
      try {
        const saved = localStorage.getItem(SESSION_KEY);
        if (!saved) return null;

        const sessionData = JSON.parse(saved);
        // Only restore if less than 24 hours old
        if (Date.now() - sessionData.timestamp > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(SESSION_KEY);
          return null;
        }
        return sessionData;
      } catch (err) {
        console.error('Failed to restore session:', err);
        return null;
      }
    }

    function clearSessionState() {
      localStorage.removeItem(SESSION_KEY);
    }

    // Save session before page unload
    window.addEventListener('beforeunload', () => {
      if (currentUser) {
        saveSessionState();
      }
    });

    function handlePasswordResetSuccess(data) {
      if (data.newPassword) {
        generatedPasswordContainer.innerHTML = `
          <div style="margin-top: 12px; font-size: 12px; color: var(--text-muted);">Your new password:</div>
          <div class="generated-password">${data.newPassword}</div>
          <div style="margin-top: 8px; font-size: 11px; color: var(--warning);">Save this password securely!</div>
        `;
      }

      // Show logout message
      const logoutMessage = document.createElement('div');
      logoutMessage.style.cssText = 'margin-top: 16px; padding: 12px; background: var(--warning); color: #000; border-radius: 4px; font-weight: 500;';
      logoutMessage.textContent = 'Password reset successful. You will be logged out in 5 seconds...';
      generatedPasswordContainer.appendChild(logoutMessage);

      resetSuccess.textContent = data.message;
      resetSuccess.classList.add('show');
      confirmResetBtn.disabled = true;

      // Logout user after delay
      setTimeout(() => {
        resetModal.classList.remove('show');
        resetSuccess.classList.remove('show');
        newPasswordInput.value = '';
        generatedPasswordContainer.innerHTML = '';
        confirmResetBtn.disabled = false;
        handleLogout();
      }, 5000);
    }

    function showError(message) {
      console.error(message);
    }

    function browseDirectory(path) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'browse', path }));
      }
    }

    function renderDirectory(data) {
      currentPath = data.path;
      currentPathEl.textContent = currentPath;
      openTerminalBtn.disabled = false;

      // Save session state when directory changes
      saveSessionState();

      directoryListEl.innerHTML = '';

      // Parent directory link
      if (data.parent) {
        const parentItem = document.createElement('div');
        parentItem.className = 'directory-item parent';
        parentItem.innerHTML = '<span class="icon">⬆️</span><span class="name">..</span>';
        parentItem.onclick = () => browseDirectory(data.parent);
        directoryListEl.appendChild(parentItem);
      }

      // Folders
      if (data.folders && data.folders.length > 0) {
        data.folders.forEach(folder => {
          const item = document.createElement('div');
          item.className = 'directory-item';
          item.innerHTML = `<span class="icon">📁</span><span class="name">${escapeHtml(folder.name)}</span><span class="navigate-btn">Browse →</span>`;
          item.onclick = () => browseDirectory(folder.path);
          // Add right-click context menu for folders
          item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showDirectoryContextMenu(e, folder.path, folder.name);
          });
          directoryListEl.appendChild(item);
        });
      }

      // Files
      if (data.files && data.files.length > 0) {
        data.files.forEach(file => {
          const item = document.createElement('div');
          item.className = 'directory-item file';
          item.innerHTML = `<span class="icon">📄</span><span class="name">${escapeHtml(file.name)}</span>`;
          directoryListEl.appendChild(item);
        });
      }

      if (data.folders?.length === 0 && data.files?.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'directory-item file';
        empty.innerHTML = '<span class="icon">📂</span><span class="name">Empty directory</span>';
        directoryListEl.appendChild(empty);
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function stripAnsiCodes(text) {
      if (typeof text !== 'string') return text;
      // Remove ANSI escape sequences (e.g. \x1b[32m, \x1b[0m, \x1b[K, etc.)
      return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    }

    // Show context menu for directory items (right-click on folders)
    function showDirectoryContextMenu(event, folderPath, folderName) {
      // Remove any existing context menu
      const existingMenu = document.getElementById('directoryContextMenu');
      if (existingMenu) {
        existingMenu.remove();
      }

      // Create context menu
      const menu = document.createElement('div');
      menu.id = 'directoryContextMenu';
      menu.className = 'context-menu';
      menu.style.cssText = `
        position: fixed;
        top: ${event.clientY}px;
        left: ${event.clientX}px;
        background: var(--bg-medium);
        border: 1px solid var(--bg-lighter);
        border-radius: 8px;
        padding: 8px 0;
        min-width: 200px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        z-index: 10000;
        font-size: 13px;
      `;

      menu.innerHTML = `
        <div class="context-menu-item" data-action="browse" style="padding: 8px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <span>📂</span> Browse
        </div>
        <div class="context-menu-item" data-action="terminal" style="padding: 8px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <span>💻</span> Open Terminal Here
        </div>
        <div class="context-menu-item" data-action="chat" style="padding: 8px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--accent-primary);">
          <span>💬</span> Open Chat in Directory
        </div>
      `;

      // Add hover styles
      const style = document.createElement('style');
      style.textContent = `
        .context-menu-item:hover {
          background: var(--bg-lighter) !important;
        }
      `;
      menu.appendChild(style);

      // Handle menu item clicks
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (!item) return;

        const action = item.dataset.action;
        menu.remove();

        switch (action) {
          case 'browse':
            browseDirectory(folderPath);
            break;
          case 'terminal':
            createTerminal(folderPath);
            break;
          case 'chat':
            createChatInDirectory(folderPath, folderName);
            break;
        }
      });

      // Close menu when clicking outside
      const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };

      // Add to DOM
      document.body.appendChild(menu);

      // Close on outside click (after small delay to avoid immediate close)
      setTimeout(() => {
        document.addEventListener('click', closeMenu);
      }, 100);
    }

    // Create a new chat session for a specific directory
    function createChatInDirectory(folderPath, folderName) {
      // Switch to chat view first
      showChatView();

      // Create chat session with directory context
      const session = createChatSessionWithDirectory(folderName, folderPath);

      if (session) {
        showNotification(`Chat session created for "${folderName}"`, 'success');
      }
    }

    // Resolve a valid model for new sessions, preferring the UI selection
    function resolveSessionModel() {
      const selected = chatModelSelect?.value;
      if (selected) return selected;
      if (availableModels.length > 0) return availableModels[0].id;
      return null;
    }

    // PI Agent is the sole engine

    // Modified createChatSession to support working directory
    function createChatSessionWithDirectory(name = null, workingDirectory = null) {
      if (!chatEnabled) {
        showNotification('Chat feature is disabled', 'warning');
        return null;
      }
      console.log('📁 createChatSessionWithDirectory called:', { name, workingDirectory, existingSessions: chatSessions.size });

      // Limit the number of sessions to prevent UI clutter
      const MAX_SESSIONS = 20;
      if (chatSessions.size >= MAX_SESSIONS) {
        showNotification(`Maximum of ${MAX_SESSIONS} chat sessions reached. Please delete some sessions.`, 'warning');
        return null;
      }

      const sessionModel = resolveSessionModel();
      if (!sessionModel) {
        showNotification('Models are still loading, please wait a moment and try again.', 'warning');
        loadAvailableModels();
        loadTtsVoices();
        return null;
      }

      const sessionId = generateSessionId();
      const sessionName = name || `Chat ${chatSessions.size + 1}`;

      const session = {
        id: sessionId,
        name: sessionName,
        model: sessionModel,
        provider: chatProviderSelect?.value || 'ollama',
        agentEngine: 'pi-agent',
        messages: [],
        initialized: false,
        initializing: false,
        serverSessionId: null,
        workingDirectory: workingDirectory,
        // Token tracking
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalReasoningTokens: 0
      };

      chatSessions.set(sessionId, session);
      console.log('✅ Created local session:', sessionId, 'Total sessions:', chatSessions.size);

      // Render the updated tabs
      renderChatTabs();

      // Set as active (may be blocked if stream is in progress)
      setActiveChatSession(sessionId);

      // Only clear the message container if we actually switched to this session
      if (activeChatSessionId === sessionId) {
        const chatMessagesContainer = document.getElementById('chatMessagesContainer');
        if (chatMessagesContainer) {
          chatMessagesContainer.innerHTML = '';

        // Show welcome message with directory context
        if (workingDirectory) {
          const welcomeDiv = document.createElement('div');
          welcomeDiv.className = 'chat-welcome';
          welcomeDiv.style.cssText = 'padding: 20px; text-align: center; color: var(--text-secondary);';
          welcomeDiv.innerHTML = `
            <div style="font-size: clamp(32px, 8vw, 48px); margin-bottom: 16px;">💬</div>
            <h3 style="margin: 0 0 8px 0; color: var(--text-primary); font-size: clamp(14px, 4vw, 18px);">Chat Session: ${escapeHtml(sessionName)}</h3>
            <p style="margin: 0; font-size: clamp(11px, 3vw, 13px);">Working directory: <code style="background: var(--bg-lighter); padding: 2px 6px; border-radius: 4px;">${escapeHtml(workingDirectory)}</code></p>
            <p style="margin: 16px 0 0 0; font-size: clamp(10px, 2.5vw, 12px); opacity: 0.7;">Type your message below to start chatting about files in this directory.</p>
          `;
          chatMessagesContainer.appendChild(welcomeDiv);
        }
        }
      }

      return session;
    }

    function createTerminal(cwd, existingTerminalId = null, shellToUse = null) {
      // For new terminals, show shell selector if we have shells available
      if (!existingTerminalId && availableShells.length > 0) {
        // If shell not specified, show selector modal
        if (!shellToUse && !selectedShell) {
          showShellSelectorModal((selected) => {
            if (selected) {
              createTerminalInternal(cwd, existingTerminalId, selected);
            }
          });
          return null; // Terminal creation deferred
        }
      }

      return createTerminalInternal(cwd, existingTerminalId, shellToUse);
    }

    function createTerminalInternal(cwd, existingTerminalId = null, shellToUse = null) {
      // Use existing terminalId if reconnecting, otherwise generate new one
      let terminalId;
      if (existingTerminalId) {
        terminalId = existingTerminalId;
        // Find the highest counter to avoid collisions
        const existingNums = Array.from(terminals.keys())
          .map(k => parseInt(k.replace('term-', '')))
          .filter(n => !isNaN(n));
        terminalCounter = Math.max(terminalCounter, ...existingNums, 0);
      } else {
        terminalCounter++;
        terminalId = `term-${terminalCounter}`;
      }

      const tabName = cwd ? cwd.split(/[\/]/).pop() || cwd : `Terminal ${terminalCounter}`;

      // Create terminal element
      const terminalEl = document.createElement('div');
      terminalEl.id = `terminal-${terminalId}`;
      terminalEl.className = 'terminal-instance';
      document.getElementById('terminalContainer').appendChild(terminalEl);

      // Create xterm instance
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
        theme: {
          background: '#0a0a0f',
          foreground: '#e0e0e8',
          cursor: '#00d4ff',
          selectionBackground: '#00d4ff44'
        },
        scrollback: 10000
      });

      const fit = new FitAddon();
      term.loadAddon(fit);

      // Get shell name from selected shell
      const shellConfig = availableShells.find(s => s.id === (shellToUse || selectedShell));
      const shellName = shellConfig?.name || 'Terminal';

      // Store terminal data BEFORE opening
      terminals.set(terminalId, {
        terminal: term,
        fitAddon: fit,
        element: terminalEl,
        cwd: cwd || '',
        name: tabName,
        isActive: false,
        id: terminalId,
        shell: shellName
      });

      // Hide no terminal message
      document.getElementById('noTerminalMsg').classList.add('hidden');

      // Open terminal BEFORE making it active so xterm can measure properly
      term.open(terminalEl);

      // Switch to new terminal (this makes it visible)
      switchToTerminal(terminalId);

      // Keyboard input handler
      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) {
          const t = terminals.get(terminalId);
          if (t?.isActive) {
            ws.send(JSON.stringify({ type: 'terminal_input', terminalId, data }));
          }
        }
      });

      // Add keyboard shortcuts for scrolling
      term.attachCustomKeyEventHandler((e) => {
        // Ctrl+Home - Jump to top of buffer
        if (e.ctrlKey && e.key === 'Home') {
          e.preventDefault();
          term.scrollToTop();
          return false;
        }
        // Ctrl+End - Jump to bottom of buffer
        if (e.ctrlKey && e.key === 'End') {
          e.preventDefault();
          term.scrollToBottom();
          return false;
        }
        // Ctrl+PageUp - Scroll up one page
        if (e.ctrlKey && e.key === 'PageUp') {
          e.preventDefault();
          term.scrollPages(-1);
          return false;
        }
        // Ctrl+PageDown - Scroll down one page
        if (e.ctrlKey && e.key === 'PageDown') {
          e.preventDefault();
          term.scrollPages(1);
          return false;
        }
        return true;
      });

      // Defer server spawn until the DOM layout settles and fitAddon has real dimensions.
      // This prevents the PTY from starting with 0-width (collapsed) cols/rows.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fit.fit();
          // Start terminal session on server with correct dimensions
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'start_terminal',
              terminalId,
              cwd: cwd || currentPath,
              cols: term.cols,
              rows: term.rows,
              shell: shellToUse || selectedShell // Send selected shell type
            }));
          }
        });
      });

      // Save session state after creating terminal
      saveSessionState();

      return terminalId;
    }

    function switchToTerminal(terminalId) {
      if (activeTerminalId === terminalId) return;

      // Deactivate current
      if (activeTerminalId) {
        const current = terminals.get(activeTerminalId);
        if (current) {
          current.element.classList.remove('active');
        }
      }

      // Activate new
      activeTerminalId = terminalId;
      const next = terminals.get(terminalId);
      if (next) {
        next.element.classList.add('active');
        // Use requestAnimationFrame to ensure element is visible before fitting
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            next.fitAddon.fit();
            // Sync PTY dimensions after fit for already-active terminals
            if (next.isActive && ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'terminal_resize',
                terminalId,
                cols: next.terminal.cols,
                rows: next.terminal.rows
              }));
            }
          });
        });
        terminalInfo.textContent = next.cwd ? `${next.shell || 'Terminal'} - ${next.cwd}` : `${next.shell || 'Terminal'} - Not connected`;
        terminalStatus.textContent = next.isActive ? `${next.shell || 'Terminal'} active` : `${next.shell || 'Terminal'} ready`;

        // Request wake lock to keep screen on when terminal is active
        requestWakeLock();
      }

      renderTabs();
    }

    function closeTerminal(terminalId) {
      const t = terminals.get(terminalId);
      if (!t) return;

      // Send close to server
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'close_terminal', terminalId }));
      }

      // Dispose xterm
      t.terminal.dispose();

      // Remove element
      t.element.remove();

      // Remove from map
      terminals.delete(terminalId);

      // Save session state
      saveSessionState();

      // Switch to another terminal or show empty state
      if (activeTerminalId === terminalId) {
        activeTerminalId = null;
        const remaining = Array.from(terminals.keys());
        if (remaining.length > 0) {
          switchToTerminal(remaining[remaining.length - 1]);
        } else {
          terminalInfo.textContent = 'Terminal - Not connected';
          terminalStatus.textContent = 'No terminal';
          document.getElementById('noTerminalMsg').classList.remove('hidden');
        }
      } else {
        renderTabs();
      }
    }

    function updateTerminalTab(terminalId, cwd) {
      const t = terminals.get(terminalId);
      if (t) {
        t.cwd = cwd;
        t.name = cwd.split(/[\\/]/).pop() || cwd;
        renderTabs();
        // Save session when terminal cwd changes
        saveSessionState();
      }
    }

    function renderTabs() {
      const tabsContainer = document.getElementById('terminalTabs');
      if (!tabsContainer) return;

      tabsContainer.innerHTML = '';

      terminals.forEach((t, id) => {
        const tab = document.createElement('div');
        tab.className = `terminal-tab ${id === activeTerminalId ? 'active' : ''}`;
        const shellIcon = t.shell ? getShellIcon(t.shell) : '🖥️';
        tab.innerHTML = `
          <span class="tab-icon" style="margin-right: 4px;">${shellIcon}</span>
          <span class="tab-name">${escapeHtml(t.name)}</span>
          <span class="tab-close" data-id="${id}">×</span>
        `;

        // Click tab to switch
        tab.addEventListener('click', (e) => {
          if (!e.target.classList.contains('tab-close')) {
            switchToTerminal(id);
          }
        });

        // Click close to close terminal
        const closeBtn = tab.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeTerminal(id);
        });

        tabsContainer.appendChild(tab);
      });
    }

    function initTerminal() {
      // Initial resize handler
      window.addEventListener('resize', () => {
        const active = terminals.get(activeTerminalId);
        if (active) {
          active.fitAddon?.fit();
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'terminal_resize',
              terminalId: activeTerminalId,
              cols: active.terminal.cols,
              rows: active.terminal.rows
            }));
          }
        }
      });
    }

    function sendResize() {
      const active = terminals.get(activeTerminalId);
      if (ws?.readyState === WebSocket.OPEN && active) {
        ws.send(JSON.stringify({
          type: 'terminal_resize',
          terminalId: activeTerminalId,
          cols: active.terminal.cols,
          rows: active.terminal.rows
        }));
      }
    }

    // Event Listeners
    logoutBtn.addEventListener('click', () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'logout', token: authToken }));
      }
      handleLogout();
    });

    resetPasswordBtn.addEventListener('click', () => {
      resetModal.classList.add('show');
      resetSuccess.classList.remove('show');
      newPasswordInput.value = '';
      generatedPasswordContainer.innerHTML = '';
    });

    cancelResetBtn.addEventListener('click', () => {
      resetModal.classList.remove('show');
    });

    autoGenBtn.addEventListener('click', () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset_password', autoGenerate: true }));
      }
    });

    confirmResetBtn.addEventListener('click', () => {
      const newPassword = newPasswordInput.value;
      if (!newPassword) {
        resetSuccess.textContent = 'Please enter a new password or use auto-generate';
        resetSuccess.classList.add('show');
        return;
      }

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset_password', newPassword }));
      }
    });

    // Change Email functionality
    changeEmailBtn.addEventListener('click', () => {
      changeEmailModal.classList.add('show');
      changeEmailSuccess.classList.remove('show');
      newEmailInput.value = '';
    });

    cancelChangeEmailBtn.addEventListener('click', () => {
      changeEmailModal.classList.remove('show');
    });

    confirmChangeEmailBtn.addEventListener('click', async () => {
      const newEmail = newEmailInput.value.trim();
      if (!newEmail) {
        changeEmailSuccess.textContent = 'Please enter a new email address';
        changeEmailSuccess.classList.add('show');
        return;
      }

      try {
        const response = await fetch('/api/auth/change-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ newEmail })
        });

        const result = await response.json();

        if (result.success) {
          // Show logout message
          changeEmailSuccess.innerHTML = `
            <div>Email updated successfully!</div>
            <div style="margin-top: 12px; padding: 12px; background: var(--warning); color: #000; border-radius: 4px; font-weight: 500;">
              You will be logged out in 5 seconds... Please log in with your new email.
            </div>
          `;
          changeEmailSuccess.classList.add('show');
          confirmChangeEmailBtn.disabled = true;

          // Logout user after delay
          setTimeout(() => {
            changeEmailModal.classList.remove('show');
            confirmChangeEmailBtn.disabled = false;
            handleLogout();
          }, 5000);
        }else {
          changeEmailSuccess.textContent = result.message || 'Failed to update email';
          changeEmailSuccess.classList.add('show');
        }
      } catch (err) {
        changeEmailSuccess.textContent = 'Error: ' + err.message;
        changeEmailSuccess.classList.add('show');
      }
    });

    openTerminalBtn.addEventListener('click', () => {
      if (currentPath) {
        // Create new terminal in current directory
        createTerminal(currentPath);

        // Close sidebar on mobile when opening terminal
        if (window.innerWidth <= 768 && sidebar) {
          sidebar.classList.remove('show');
          sidebarOverlay?.classList.remove('show');
        }
      }
    });

    refreshBtn.addEventListener('click', () => {
      browseDirectory(currentPath);
    });

    // Copy path button functionality
    if (copyPathBtn) {
      copyPathBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(currentPath || '');
          copyPathBtn.classList.add('copied');
          copyPathBtn.textContent = '✓';
          setTimeout(() => {
            copyPathBtn.classList.remove('copied');
            copyPathBtn.textContent = '📋';
          }, 1500);
        } catch (err) {
          console.error('Failed to copy path:', err);
        }
      });
    }

    newTerminalBtn.addEventListener('click', () => {
      createTerminal(currentPath);
    });

    // Shell selector button - shows modal to change default shell
    if (selectShellBtn) {
      selectShellBtn.addEventListener('click', () => {
        if (availableShells.length === 0) {
          showNotification('Loading available shells...', 'info');
          fetchAvailableShells().then(() => {
            if (availableShells.length > 0) {
              showShellSelectorModal((selected) => {
                if (selected) {
                  showNotification(`Default shell set to: ${availableShells.find(s => s.id === selected)?.name || selected}`, 'success');
                }
              });
            } else {
              showNotification('No shells available', 'error');
            }
          });
        } else {
          showShellSelectorModal((selected) => {
            if (selected) {
              showNotification(`Default shell set to: ${availableShells.find(s => s.id === selected)?.name || selected}`, 'success');
            }
          });
        }
      });
    }

    clearTerminalBtn.addEventListener('click', () => {
      const active = terminals.get(activeTerminalId);
      active?.terminal.clear();
    });

    // Saved Commands Functions
    async function loadSavedCommands() {
      try {
        const response = await fetch('/api/commands', {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        const result = await response.json();
        if (result.success) {
          // Map database format to frontend format
          savedCommands = result.commands.map(cmd => ({
            id: cmd.id,
            name: cmd.name,
            text: cmd.command_text
          }));
        } else {
          savedCommands = [];
        }
      } catch (err) {
        console.error('Failed to load saved commands:', err);
        savedCommands = [];
      }
      renderSavedCommands();
    }

    async function addSavedCommand(name, text) {
      try {
        const response = await fetch('/api/commands', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ name, command: text })
        });
        const result = await response.json();
        if (result.success) {
          await loadSavedCommands(); // Reload from server
          showNotification('Command saved successfully', 'success');
          return true;
        } else {
          showNotification('Failed to save command: ' + result.message, 'error');
          return false;
        }
      } catch (err) {
        showNotification('Error saving command: ' + err.message, 'error');
        return false;
      }
    }

    async function removeSavedCommand(commandId) {
      try {
        const response = await fetch(`/api/commands/${commandId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        const result = await response.json();
        if (result.success) {
          await loadSavedCommands(); // Reload from server
          showNotification('Command deleted successfully', 'success');
          return true;
        } else {
          showNotification('Failed to delete command: ' + result.message, 'error');
          return false;
        }
      } catch (err) {
        showNotification('Error deleting command: ' + err.message, 'error');
        return false;
      }
    }

    function renderSavedCommands() {
      if (!savedCommandsList) return;

      if (savedCommands.length === 0) {
        savedCommandsList.innerHTML = `
          <div class="no-commands-message">
            No saved commands yet. Add your first command below!
          </div>
        `;
        return;
      }

      savedCommandsList.innerHTML = savedCommands.map((cmd, index) => `
        <div class="saved-command-item">
          <div class="saved-command-info">
            <div class="saved-command-name">${escapeHtml(cmd.name)}</div>
            <div class="saved-command-text">${escapeHtml(cmd.text)}</div>
          </div>
          <div class="saved-command-actions">
            <button class="btn btn-primary" onclick="loadCommandToTerminal(${index})">Load</button>
            <button class="btn btn-secondary" onclick="deleteSavedCommand(${index})">Delete</button>
          </div>
        </div>
      `).join('');
    }

    // Make functions available globally for inline onclick handlers
    window.loadCommandToTerminal = function(index) {
      const cmd = savedCommands[index];
      if (!cmd) return;

      const active = terminals.get(activeTerminalId);
      if (active?.terminal) {
        // Send command to terminal with newline to execute
        active.terminal.paste(cmd.text + '\r');
        savedCommandsModal.classList.remove('show');
        showNotification('Command sent to terminal', 'success');
      } else {
        showNotification('No active terminal. Please open a terminal first.', 'warning');
      }
    };

    window.deleteSavedCommand = async function(index) {
      const cmd = savedCommands[index];
      if (!cmd) return;

      if (confirm('Delete this saved command?')) {
        await removeSavedCommand(cmd.id);
      }
    };

    // Saved Commands Event Listeners
    if (savedCommandsBtn) {
      savedCommandsBtn.addEventListener('click', async () => {
        await loadSavedCommands();
        savedCommandsModal?.classList.add('show');
      });
    }

    if (cancelSavedCommandsBtn) {
      cancelSavedCommandsBtn.addEventListener('click', () => {
        savedCommandsModal?.classList.remove('show');
      });
    }

    if (addCommandBtn) {
      addCommandBtn.addEventListener('click', async () => {
        const name = newCommandName?.value.trim();
        const text = newCommandText?.value.trim();

        if (!name || !text) {
          showNotification('Please enter both a name and command', 'warning');
          return;
        }

        const success = await addSavedCommand(name, text);
        if (success) {
          // Clear inputs
          newCommandName.value = '';
          newCommandText.value = '';
        }
      });
    }

    // Sidebar toggles (mobile overlay + desktop collapse)
    const pathToggleBtn = document.getElementById('pathToggleBtn');
    const pathDisplay = document.getElementById('pathDisplay');
    const desktopCollapseBtn = document.getElementById('desktopCollapseBtn');

    const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed';
    const PATH_VISIBLE_KEY = 'path_visible';

    function isDesktop() {
      return window.innerWidth >= 769;
    }

    function applySidebarCollapseState() {
      const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
      if (collapsed && isDesktop()) {
        appContainer.classList.add('sidebar-collapsed');
      } else {
        appContainer.classList.remove('sidebar-collapsed');
      }
    }

    function applyPathVisibilityState() {
      const visible = localStorage.getItem(PATH_VISIBLE_KEY) !== 'false';
      if (visible) {
        pathDisplay?.classList.remove('collapsed');
      } else {
        pathDisplay?.classList.add('collapsed');
      }
    }

    applySidebarCollapseState();
    applyPathVisibilityState();

    if (pathToggleBtn && pathDisplay) {
      pathToggleBtn.style.display = 'inline-block';
      pathToggleBtn.addEventListener('click', () => {
        const isCollapsed = pathDisplay.classList.toggle('collapsed');
        localStorage.setItem(PATH_VISIBLE_KEY, String(!isCollapsed));
      });
    }

    if (desktopCollapseBtn) {
      desktopCollapseBtn.addEventListener('click', () => {
        appContainer.classList.toggle('sidebar-collapsed');
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(appContainer.classList.contains('sidebar-collapsed')));
      });
    }

    if (sidebarToggle && sidebarOverlay) {
      console.log('[Init] Attaching sidebar event listeners');
      
      function toggleMobileSidebar() {
        console.log('[Sidebar Toggle] Clicked! isDesktop:', isDesktop());
        if (isDesktop()) {
          appContainer.classList.toggle('sidebar-collapsed');
          localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(appContainer.classList.contains('sidebar-collapsed')));
        } else {
          const isOpen = sidebar.classList.contains('show');
          console.log('[Sidebar Toggle] Mobile mode, sidebar is Open:', isOpen);
          if (isOpen) {
            sidebar.classList.remove('show');
            sidebarOverlay.classList.remove('show');
            // EMERGENCY: Force styles inline
            sidebar.style.transform = 'translateX(-100%)';
            sidebar.style.display = 'none';
            sidebarOverlay.style.display = 'none';
            console.log('[Sidebar Toggle] Sidebar closed with inline styles');
          } else {
            sidebar.classList.add('show');
            sidebarOverlay.classList.add('show');
            // EMERGENCY: Force styles inline in case CSS isn't working
            sidebar.style.transform = 'translateX(0)';
            sidebar.style.display = 'flex';
            sidebarOverlay.style.display = 'block';
            console.log('[Sidebar Toggle] Sidebar opened with inline styles');
          }
        }
      }

      function closeMobileSidebar() {
        sidebar.classList.remove('show');
        sidebarOverlay.classList.remove('show');
      }

      sidebarToggle.addEventListener('click', (e) => {
        console.log('[Sidebar] Hamburger clicked');
        toggleMobileSidebar();
      });
      // Also handle touch for PWA mobile where click may be delayed
      sidebarToggle.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleMobileSidebar();
      });

      sidebarOverlay.addEventListener('click', closeMobileSidebar);
      sidebarOverlay.addEventListener('touchend', (e) => {
        e.preventDefault();
        closeMobileSidebar();
      });
      
      // Swipe to close sidebar on mobile
      let touchStartX = 0;
      sidebar.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });
      
      sidebar.addEventListener('touchmove', (e) => {
        if (!sidebar.classList.contains('show')) return;
        const touchX = e.touches[0].clientX;
        const diff = touchStartX - touchX;
        // If swiping left more than 50px, close sidebar
        if (diff > 50) {
          closeMobileSidebar();
        }
      }, { passive: true });
    }

    // Debug: Track all clicks
    document.addEventListener('click', (e) => {
      console.log('[Click Debug] Clicked element:', e.target.tagName, e.target.id, e.target.className);
    });

    // PWA Install Button
    let deferredPrompt = null;

    function isPwaInstalled() {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function isIos() {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    function showInstallModal(title, htmlContent) {
      const modal = document.createElement('div');
      modal.className = 'modern-modal-overlay show';
      modal.innerHTML = `
        <div class="modern-modal" style="max-width: 420px;">
          <div class="modern-modal-title">${escapeHtml(title)}</div>
          <div class="modern-modal-message">${htmlContent}</div>
          <div class="modern-modal-actions">
            <button class="btn btn-primary" id="installModalOk">Got it</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const okBtn = modal.querySelector('#installModalOk');
      const remove = () => modal.remove();
      okBtn.addEventListener('click', remove);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) remove();
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (pwaInstallBtn && !isPwaInstalled()) {
        pwaInstallBtn.classList.add('show');
      }
    });

    if (pwaInstallBtn) {
      // Show button on iOS immediately if not installed
      if (isIos() && !isPwaInstalled()) {
        pwaInstallBtn.classList.add('show');
      }

      pwaInstallBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            pwaInstallBtn.classList.remove('show');
          }
          deferredPrompt = null;
          return;
        }

        if (isIos()) {
          showInstallModal(
            'Install on iOS',
            `<p style="margin-bottom:12px;">To install this app on your iPhone or iPad:</p>
             <ol style="padding-left:20px;line-height:1.6;">
               <li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
               <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
               <li>Tap <strong>Add</strong> in the top right corner.</li>
             </ol>`
          );
          return;
        }

        // Generic fallback for other browsers
        showInstallModal(
          'Install App',
          `<p style="margin-bottom:12px;">To install this app:</p>
           <ul style="padding-left:20px;line-height:1.6;">
             <li><strong>Chrome / Edge:</strong> Look for the install icon in the address bar.</li>
             <li><strong>Android:</strong> Open the browser menu and tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
             <li><strong>Desktop:</strong> Check the address bar for an install icon or use the browser menu.</li>
           </ul>`
        );
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('PWA was installed');
      pwaInstallBtn?.classList.remove('show');
      deferredPrompt = null;
    });

    // Register Service Worker for background support
    if ('serviceWorker' in navigator) {
      (async () => {
        try {
          swRegistration = await navigator.serviceWorker.register('/sw.js');
          console.log('Service Worker registered:', swRegistration.scope);

          // Listen for updates
          swRegistration.addEventListener('updatefound', () => {
            const newWorker = swRegistration.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New Service Worker available');
              }
            });
          });
        } catch (err) {
          console.error('Service Worker registration failed:', err);
        }
      })();
    }

    // EMERGENCY DEBUG: Check sidebar toggle immediately and repeatedly
    console.log('[EMERGENCY] Running sidebar debug...');
    function checkSidebarToggle() {
      const btn = document.getElementById('sidebarToggle');
      console.log('[EMERGENCY] sidebarToggle element:', btn);
      if (btn) {
        btn.onclick = function() {
          console.log('[EMERGENCY] Button clicked via onclick!');
          alert('Sidebar toggle clicked!');
        };
      }
    }
    checkSidebarToggle();
    setTimeout(checkSidebarToggle, 1000);
    setTimeout(checkSidebarToggle, 5000);
    
    // Debug: check sidebar toggle after a delay
    setTimeout(() => {
      const btn = document.getElementById('sidebarToggle');
      if (btn) {
        const styles = window.getComputedStyle(btn);
        console.log('[Debug] Sidebar toggle computed styles:', {
          display: styles.display,
          visibility: styles.visibility,
          zIndex: styles.zIndex
        });
      }
    }, 3000);

    // Pull to Refresh (for mobile PWA) - only when at top and not interacting with terminal
    let ptrStartY = 0;
    let ptrPulling = false;
    let ptrThreshold = 150; // Increased threshold for less sensitivity

    // Check if touch is within terminal area
    function isTouchInTerminal(touch) {
      const terminalEl = document.querySelector('.terminal-container');
      if (!terminalEl) return false;
      const rect = terminalEl.getBoundingClientRect();
      return touch.clientY >= rect.top && touch.clientY <= rect.bottom &&
             touch.clientX >= rect.left && touch.clientX <= rect.right;
    }

    document.addEventListener('touchstart', (e) => {
      // Only trigger if at top of page, not in terminal, and not in any scrollable content
      if (window.scrollY === 0 && !isTouchInTerminal(e.touches[0])) {
        // Check if target is a scrollable element
        let el = e.target;
        while (el && el !== document.body) {
          if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) {
            return; // Don't start PTR if element is scrolled
          }
          el = el.parentElement;
        }
        ptrStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (ptrStartY > 0 && !ptrPulling) {
        const currentY = e.touches[0].clientY;
        const diff = currentY - ptrStartY;

        // Increased threshold and check we're actually pulling down
        if (diff > ptrThreshold && window.scrollY === 0 && currentY > ptrStartY) {
          ptrPulling = true;
          ptrIndicator?.classList.add('show');
        }
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (ptrPulling) {
        ptrPulling = false;
        ptrIndicator?.classList.remove('show');

        // Trigger page refresh only if we're still at the top
        if (window.scrollY === 0) {
          window.location.reload();
        }
      }
      ptrStartY = 0;
    });

    // Page Visibility API - refresh when returning to page
    // Track if we're reconnecting (not first connection)
    let isReconnecting = false;
    let pingInterval = null;
    let swRegistration = null;

    // Service Worker message handling
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'sync' && event.data?.tag === 'keep-alive') {
          console.log('Background sync triggered - ensuring connection');
          // Ensure WebSocket is connected
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            connect();
          }
        }
        if (event.data?.type === 'periodic-sync' && event.data?.tag === 'terminal-keepalive') {
          console.log('Periodic background sync triggered');
        }
      });
    }

    // Register for background sync to keep alive when hidden
    async function registerBackgroundSync() {
      if ('serviceWorker' in navigator && swRegistration) {
        try {
          // Register for one-time sync
          if ('sync' in swRegistration) {
            await swRegistration.sync.register('keep-alive');
            console.log('Background sync registered');
          }
          // Register for periodic sync (if supported and permitted)
          if ('periodicSync' in swRegistration) {
            const status = await navigator.permissions.query({
              name: 'periodic-background-sync',
            });
            if (status.state === 'granted') {
              await swRegistration.periodicSync.register('terminal-keepalive', {
                minInterval: 60000, // Minimum 1 minute between syncs
              });
              console.log('Periodic background sync registered');
            }
          }
        } catch (err) {
          console.warn('Background sync registration failed:', err.message);
        }
      }
    }

    // Trigger background sync periodically when hidden
    setInterval(() => {
      if (document.visibilityState === 'hidden' && swRegistration) {
        registerBackgroundSync();
      }
    }, 30000); // Try to register sync every 30s when hidden

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Reconnect WebSocket if needed (after phone unlock)
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('Page visible - reconnecting WebSocket');
          isReconnecting = true;
          connect();
        }
        // Ensure ping is running
        if (!pingInterval && ws?.readyState === WebSocket.OPEN) {
          startPingInterval();
        }
        // Re-acquire wake lock when returning
        if (activeTerminalId) {
          requestWakeLock();
        }
      } else {
        // Page hidden - DON'T stop ping interval, keep connection alive
        // but register background sync to keep service worker alive
        console.log('Page hidden - registering background sync');
        registerBackgroundSync();
      }
    });

    function startPingInterval() {
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
          // Also ping service worker to keep it alive
          if (swRegistration && swRegistration.active) {
            swRegistration.active.postMessage({ type: 'KEEP_ALIVE' });
          }
        }
      }, 30000); // Ping every 30 seconds
    }

    function stopPingInterval() {
      // Only stop ping on full disconnect, not on visibility change
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }

    // Handle beforeunload to mark intentional navigation
    window.addEventListener('beforeunload', () => {
      sessionStorage.setItem('intentional_reload', Date.now().toString());
      // Release wake lock on intentional navigation
      releaseWakeLock();
    });

    // Check if this is a reload vs fresh start
    const lastUnload = sessionStorage.getItem('intentional_reload');
    if (lastUnload) {
      // Was a reload within last 5 seconds, likely reconnection
      if (Date.now() - parseInt(lastUnload) < 5000) {
        isReconnecting = true;
      }
      sessionStorage.removeItem('intentional_reload');
    }

    // ==========================================
    // PI Agent Chat Functions
    // ==========================================
    // Multi-Session PI Agent Chat Functions
    // ==========================================

    // View Toggle Functions
    function showTerminalView() {
      terminalView.style.display = 'flex';
      chatPage.classList.remove('show');
      viewTerminalBtn.classList.add('active');
      viewChatBtn.classList.remove('active');
      updateHeaderForView('terminal');
    }

    function showChatView() {
      if (!chatEnabled) {
        showNotification('Chat feature is disabled', 'warning');
        return;
      }
      terminalView.style.display = 'none';
      chatPage.classList.add('show');
      viewTerminalBtn.classList.remove('active');
      viewChatBtn.classList.add('active');
      updateHeaderForView('chat');

      // Load Ollama config to populate model input
      loadOllamaConfig();

      // Load sessions if first time
      if (chatSessions.size === 0) {
        loadChatSessions();
      }
    }

    function updateHeaderForView(view) {
      const terminalInfo = document.getElementById('terminalInfo');
      if (view === 'terminal') {
        terminalInfo.textContent = activeTerminalId
          ? `Terminal - ${terminals.get(activeTerminalId)?.name || 'Active'}`
          : 'Terminal - Not connected';
      } else {
        const session = chatSessions.get(activeChatSessionId);
        terminalInfo.textContent = session
          ? `Chat - ${session.name}`
          : 'Chat - Select or create a session';
      }
    }

    // Chat Session Management
    function generateSessionId() {
      return `chat_${Date.now()}_${++chatSessionCounter}`;
    }

    function createChatSession(name = null, model = null) {
      if (creatingSession) {
        console.log('⛔ createChatSession blocked: already creating');
        return null;
      }
      if (!chatEnabled) {
        showNotification('Chat feature is disabled', 'warning');
        return null;
      }

      // Require working directory before creating a chat session
      if (!currentPath) {
        showNotification('Please select a working directory first. Use the file browser to open a folder, then start a chat.', 'warning');
        // Switch to terminal view to encourage directory selection
        showTerminalView();
        return null;
      }

      // Limit the number of sessions to prevent UI clutter
      const MAX_SESSIONS = 20;
      if (chatSessions.size >= MAX_SESSIONS) {
        showNotification(`Maximum of ${MAX_SESSIONS} chat sessions reached. Please delete some sessions.`, 'warning');
        return null;
      }

      const sessionModel = model || resolveSessionModel();
      if (!sessionModel) {
        showNotification('Models are still loading, please wait a moment and try again.', 'warning');
        loadAvailableModels();
        loadTtsVoices();
        return null;
      }

      creatingSession = true;

      const sessionId = generateSessionId();
      const sessionName = name || `Chat ${chatSessions.size + 1}`;

      const session = {
        id: sessionId,
        name: sessionName,
        model: sessionModel,
        agentEngine: 'pi-agent',
        messages: [],
        initialized: false,
        initializing: false,
        serverSessionId: null
      };

      chatSessions.set(sessionId, session);
      renderChatTabs();
      setActiveChatSession(sessionId);

      // Session creation is handled by initializeChatSession() in setActiveChatSession
      // No need to send duplicate request here

      // Reset guard after a short delay to allow the init flow to start
      setTimeout(() => { creatingSession = false; }, 500);

      return session;
    }

    function showEmptyChatState() {
      emptyChatState.style.display = 'flex';
      chatActiveUi.style.display = 'none';
      activeChatSessionId = null;
      if (chatProviderSelect) chatProviderSelect.disabled = false;
    }

    function setActiveChatSession(sessionId) {
      // CRITICAL FIX: Check if there's an active stream in ANY session
      // If so, don't allow tab switching - let the stream complete first
      if (streamingMessages.size > 0) {
        const activeStreamSession = Array.from(streamingMessages.keys())[0];
        if (activeStreamSession !== sessionId) {
          console.log('[setActiveChatSession] BLOCKED - cannot switch tabs while streaming in', activeStreamSession);
          showNotification('Please wait for the current response to complete before switching chats', 'warning');
          return;
        }
      }

      // CRITICAL FIX: Check if there's an active stream in the CURRENT session
      // If so, don't switch immediately - let the stream complete first
      if (activeChatSessionId) {
        const currentSession = chatSessions.get(activeChatSessionId);
        if (currentSession && streamingMessages.has(activeChatSessionId)) {
          console.log('[setActiveChatSession] Delaying switch - active stream in progress for', activeChatSessionId);
          showNotification('Waiting for response to complete before switching...', 'info');
          // Wait a bit and try again
          setTimeout(() => setActiveChatSession(sessionId), 1000);
          return;
        }
      }

      // Deactivate previous
      if (activeChatSessionId) {
        const prevTab = document.querySelector(`[data-session-id="${activeChatSessionId}"]`);
        prevTab?.classList.remove('active');
      }

      activeChatSessionId = sessionId;
      saveActiveChatSession(sessionId); // Persist active session

      const session = chatSessions.get(sessionId);

      if (session) {
        console.log('🎯 setActiveChatSession called:', sessionId, 'initialized:', session.initialized, 'initializing:', session.initializing);

        const tab = document.querySelector(`[data-session-id="${sessionId}"]`);
        tab?.classList.add('active');

        emptyChatState.style.display = 'none';
        chatActiveUi.style.display = 'flex';

        if (chatModelSelect) {
          chatModelSelect.value = session.model;
        }
        if (chatProviderSelect && session.provider) {
          if (Array.from(chatProviderSelect.options).some(o => o.value === session.provider)) {
            chatProviderSelect.value = session.provider;
          }
          // Lock provider for existing sessions; allow changes only for brand-new sessions
          chatProviderSelect.disabled = !!(session.initialized || session.serverSessionId);
        }

        renderChatMessages(session);

        // Reset global work indicators when switching tabs; only restore if this session has active work
        resetAgentWorkingIndicator();
        if (streamingMessages.has(session.id)) {
          showAgentWorkingIndicator();
        }

        // Auto-initialize if not initialized and not already initializing
        // OR if the session has serverSessionId but needs server reconnect (loaded from API)
        if ((!session.initialized && !session.initializing) || session._needsServerReconnect) {
          if (session.serverSessionId) {
            console.log('🔄 Auto-initializing existing session:', sessionId);
            // Clear the reconnect flag once we start initializing
            session._needsServerReconnect = false;
            initializeChatSession(sessionId, session.workingDirectory || null);
            updateChatStatus('connecting');
            enableChatInput(false);
          } else {
            console.log('⏳ New session - deferring init until first message:', sessionId);
            updateChatStatus('online');
            enableChatInput(true);
          }
        } else if (session.initializing) {
          console.log('⏳ Session already initializing, skipping:', sessionId);
          updateChatStatus('connecting');
          enableChatInput(false);
        } else {
          updateChatStatus('online');
          enableChatInput(true);
        }
      } else {
        emptyChatState.style.display = 'flex';
        chatActiveUi.style.display = 'none';
        activeChatSessionId = null;
      }

      updateHeaderForView('chat');
    }

    function renderChatTabs() {
      chatTabs.innerHTML = `
        <button class="chat-tab new-session-btn" id="newChatSessionBtn2" title="New Chat Session">
          <span>+</span>
        </button>
        <button class="chat-tab close-all-btn" id="closeAllChatSessionsBtn2" title="Close All Sessions">
          <span>🗑️ Close All</span>
        </button>
      `;

      chatSessions.forEach((session, sessionId) => {
        const tab = document.createElement('div');
        tab.className = `chat-tab ${sessionId === activeChatSessionId ? 'active' : ''}`;
        tab.dataset.sessionId = sessionId;
        tab.innerHTML = `
          <span class="chat-tab-name">${session.name}</span>
          <button class="chat-tab-close" data-close="${sessionId}" title="Close session">×</button>
        `;

        tab.addEventListener('click', (e) => {
          if (e.target.dataset.close) {
            e.stopPropagation();
            deleteChatSession(e.target.dataset.close);
          } else {
            setActiveChatSession(sessionId);
          }
        });

        // Add right-click context menu
        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showChatTabContextMenu(e, sessionId);
        });

        chatTabs.insertBefore(tab, chatTabs.lastElementChild);
      });

      document.getElementById('newChatSessionBtn2')?.addEventListener('click', () => {
        createChatSession();
      });

      document.getElementById('closeAllChatSessionsBtn2')?.addEventListener('click', () => {
        showConfirmationModal(
          'Close All Chat Sessions',
          `Are you sure you want to close all ${chatSessions.size} chat session${chatSessions.size !== 1 ? 's' : ''}? This will delete all conversations.`,
          () => {
            closeAllChatSessions();
          }
        );
      });
    }

    function renderChatMessages(session) {
      // CRITICAL FIX: Never re-render if there's an active stream for ANY session
      // This prevents streaming content from disappearing mid-stream
      if (streamingMessages.size > 0) {
        const activeStreamingSession = Array.from(streamingMessages.keys())[0];
        console.log('[renderChatMessages] BLOCKED - active stream in progress for session:', activeStreamingSession);
        return;
      }

      // Also check specific session
      const activeStream = streamingMessages.get(session.id);
      if (activeStream) {
        console.log('[renderChatMessages] Skipping re-render, active stream in progress for', session.id);
        return;
      }

      // Also check if we recently completed ANY stream (within last 1 second)
      // This prevents race conditions where render is called right after completion
      const anyRecentStream = Array.from(chatSessions.values()).some(s =>
        s._lastStreamCompleteTime && (Date.now() - s._lastStreamCompleteTime) < 1000
      );
      if (anyRecentStream) {
        console.log('[renderChatMessages] Skipping re-render, stream just completed');
        return;
      }

      // Check if this session recently completed (within last 500ms)
      const lastStreamTime = session._lastStreamCompleteTime;
      if (lastStreamTime && (Date.now() - lastStreamTime) < 500) {
        console.log('[renderChatMessages] Skipping re-render, stream just completed for', session.id);
        return;
      }

      // Don't re-render active streaming sessions - the streamEl would be destroyed
      const activeStreamEntry = [...streamingMessages.entries()].find(([_, el]) => el && el.parentNode);
      if (activeStreamEntry) {
        const activeStreamSessionId = activeStreamEntry[0];
        if (activeStreamSessionId === sessionId || activeStreamSessionId === session.serverSessionId) {
          console.log('[renderChatMessages] Skipping re-render, active stream for', sessionId);
          return;
        }
      }

      // Preserve typing indicator across re-renders (e.g. reconnect with history)
      const indicator = document.getElementById('typing-indicator');

      chatMessagesContainer.innerHTML = '';

      if (!Array.isArray(session.messages)) session.messages = [];

      if (session.messages.length === 0 && !indicator) {
        chatMessagesContainer.innerHTML = `
          <div class="empty-chat-state" style="flex: 1; opacity: 0.7;">
            <p style="font-size: 14px;">Start the conversation by typing a message below.</p>
          </div>
        `;
        return;
      }

      session.messages.forEach(msg => {
        // Skip messages with empty or missing content to avoid blank bubbles
        if (msg.content && typeof msg.content === 'string' && msg.content.trim().length > 0) {
          appendMessageToContainer(msg.content, msg.role);
        }
      });

      // Re-attach streaming element if this session has an active stream
      const streamEl = streamingMessages.get(session.id);
      if (streamEl && !streamEl.parentNode) {
        chatMessagesContainer.appendChild(streamEl);
      }

      // Restore typing indicator so it survives tab switches / history reloads,
      // but only if it belongs to the session being rendered
      if (indicator && indicator.dataset.sessionId === session.id) {
        chatMessagesContainer.appendChild(indicator);
      }

      scrollToBottom();
    }

    // Robust markdown formatter: escapes HTML, handles triple-backtick code blocks,
    // headers, bold, italic, links, lists, blockquotes and inline code.
    function formatMarkdown(text) {
      if (!text) return '';
      let html = escapeHtml(text);
      const parts = html.split('```');
      let result = '';
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          // Normal text
          let segment = parts[i];

          // Links [text](url)
          segment = segment.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent-primary);text-decoration:underline;">$1</a>');

          // Headers (process longest first)
          segment = segment.replace(/^#{6}\s+(.+)$/gm, '<h6 style="margin:6px 0;font-size:12px;opacity:0.85;">$1</h6>');
          segment = segment.replace(/^#{5}\s+(.+)$/gm, '<h5 style="margin:6px 0;font-size:13px;opacity:0.85;">$1</h5>');
          segment = segment.replace(/^#{4}\s+(.+)$/gm, '<h4 style="margin:6px 0;font-size:14px;opacity:0.85;">$1</h4>');
          segment = segment.replace(/^#{3}\s+(.+)$/gm, '<h3 style="margin:8px 0;font-size:15px;opacity:0.9;">$1</h3>');
          segment = segment.replace(/^#{2}\s+(.+)$/gm, '<h2 style="margin:8px 0;font-size:17px;opacity:0.9;">$1</h2>');
          segment = segment.replace(/^#{1}\s+(.+)$/gm, '<h1 style="margin:8px 0;font-size:19px;opacity:0.9;">$1</h1>');

          // Bold (**text**)
          segment = segment.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

          // Italic (*text* or _text_) - avoid converting bold remnants
          segment = segment.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>');
          segment = segment.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>');

          // Inline code
          segment = segment.replace(/`([^`]+)`/g, '<code style="background:var(--bg-darker);padding:2px 6px;border-radius:3px;font-family:Consolas,Monaco,monospace;font-size:13px;">$1</code>');

          // Blockquotes
          segment = segment.replace(/^>\s+(.+)$/gm, '<blockquote style="border-left:3px solid var(--accent-primary);padding-left:10px;margin:4px 0;opacity:0.9;">$1</blockquote>');

          // Unordered lists
          segment = segment.replace(/^(\s*)[-*+]\s+(.+)$/gm, (m, indent, content) => `<ul style="margin:2px 0;padding-left:20px;"><li>${content}</li></ul>`);

          // Ordered lists
          segment = segment.replace(/^(\s*)\d+\.\s+(.+)$/gm, (m, indent, content) => `<ol style="margin:2px 0;padding-left:20px;"><li>${content}</li></ol>`);

          // Horizontal rules
          segment = segment.replace(/^[\s]*(?:-{3,}|\*{3,}|_{3,})[\s]*$/gm, '<hr style="border:none;border-top:1px solid var(--bg-lighter);margin:10px 0;">');

          // Line breaks
          segment = segment.replace(/\n/g, '<br>');

          // Merge adjacent list tags into single lists
          segment = segment.replace(/<\/ul>(?:<br>)*<ul[^>]*>/g, '');
          segment = segment.replace(/<\/ol>(?:<br>)*<ol[^>]*>/g, '');

          result += segment;
        } else {
          // Code block
          let code = parts[i];
          let lang = '';
          const firstNewline = code.indexOf('\n');
          if (firstNewline !== -1) {
            lang = code.substring(0, firstNewline).trim();
            code = code.substring(firstNewline + 1);
          }
          code = code.replace(/\n/g, '<br>');
          const langLabel = lang ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${escapeHtml(lang)}</div>` : '';
          result += `<div class="chat-code-block" style="background:var(--bg-darker);padding:12px;border-radius:8px;margin:8px 0;overflow-x:auto;">${langLabel}<code style="font-family:Consolas,Monaco,monospace;font-size:13px;">${code}</code></div>`;
        }
      }
      return result;
    }

    function appendMessageToContainer(content, role, imagePath = null) {
      // Guard against empty/undefined content creating blank bubbles
      if (!content || (typeof content === 'string' && content.trim().length === 0)) {
        return;
      }

      const messageEl = document.createElement('div');
      messageEl.className = `chat-message ${role}`;

      let formattedContent = formatMarkdown(content);

      // Build message content
      let messageHTML = formattedContent;

      // Add image if present
      if (imagePath && role === 'user') {
        const imageFileName = imagePath.split('/').pop() || imagePath.split('\\').pop();
        messageHTML += `
          <div class="message-image">
            <img src="/api/images/${encodeURIComponent(imagePath)}" alt="${escapeHtml(imageFileName)}"
                 style="max-width: 200px; border-radius: 8px; border: 1px solid var(--bg-lighter); margin-top: 8px; display: block;"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
            />
            <div class="image-error" style="display: none; color: var(--text-muted); font-size: 11px;">Image: ${escapeHtml(imageFileName)}</div>
          </div>
        `;
      }

      // Add TTS button for assistant messages
      if (role === 'assistant') {
        const ttsBtn = document.createElement('button');
        ttsBtn.className = 'tts-btn';
        ttsBtn.innerHTML = '🔊';
        ttsBtn.title = 'Speak message';
        ttsBtn.onclick = (e) => {
          e.stopPropagation();
          playTts(content, ttsBtn);
        };
        messageEl.appendChild(ttsBtn);
      }

      // Add avatar icon for user and assistant messages
      if (role === 'user' || role === 'assistant') {
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar-header';
        avatarDiv.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 12px; font-weight: 600; opacity: 0.8;';
        if (role === 'assistant') {
          avatarDiv.innerHTML = '<span>🤖</span><span>AI Assistant</span>';
          avatarDiv.style.color = 'var(--accent-secondary, #a78bfa)';
        } else {
          avatarDiv.innerHTML = '<span>👤</span><span>You</span>';
          avatarDiv.style.color = 'var(--accent-primary, #00d4aa)';
        }
        messageEl.appendChild(avatarDiv);
      }

      const contentSpan = document.createElement('span');
      contentSpan.className = 'message-content';
      contentSpan.innerHTML = messageHTML;
      messageEl.appendChild(contentSpan);

      // Add resend button for user messages
      if (role === 'user') {
        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display:flex;gap:8px;margin-top:6px;opacity:0.7;';
        const resendBtn = document.createElement('button');
        resendBtn.innerHTML = '↻ Resend';
        resendBtn.title = 'Resend message';
        resendBtn.style.cssText = 'background:none;border:none;color:var(--bg-dark);cursor:pointer;font-size:11px;padding:2px 0;';
        resendBtn.onclick = () => {
          if (chatInput) {
            chatInput.value = content;
            chatInput.style.height = 'auto';
            chatInput.style.height = chatInput.scrollHeight + 'px';
            sendChatMessage();
          }
        };
        actionsDiv.appendChild(resendBtn);
        messageEl.appendChild(actionsDiv);
      }

      messageEl.dataset.timestamp = Date.now();
      chatMessagesContainer.appendChild(messageEl);

      // Auto-scroll to bottom after appending
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }

    async function playTts(text, btnElement) {
      // If already playing this message, stop it
      if (currentTtsAudio && playingTtsBtn === btnElement) {
        stopTts();
        return;
      }

      // Stop any other playing TTS
      stopTts();

      btnElement.textContent = '⏳';
      btnElement.classList.add('loading');
      playingTtsBtn = btnElement;

      try {
        const voice = ttsVoiceSelect?.value || '';
        const body = voice ? JSON.stringify({ text, voice }) : JSON.stringify({ text });
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body
        });

        if (!res.ok) throw new Error('TTS generation failed');

        const data = await res.json();
        if (data.success) {
          currentTtsAudio = new Audio(data.audioUrl);
          currentTtsAudio.onended = () => {
            btnElement.textContent = '🔊';
            btnElement.classList.remove('playing');
            currentTtsAudio = null;
            playingTtsBtn = null;
          };
          currentTtsAudio.onerror = () => {
            btnElement.textContent = '❌';
            btnElement.classList.remove('loading', 'playing');
            currentTtsAudio = null;
            playingTtsBtn = null;
            showNotification('Failed to play audio', 'error');
          };

          btnElement.textContent = '⏹️';
          btnElement.classList.remove('loading');
          btnElement.classList.add('playing');
          await currentTtsAudio.play();
        } else {
          throw new Error(data.error || 'Failed to generate TTS');
        }
      } catch (err) {
        console.error('TTS error:', err);
        btnElement.textContent = '❌';
        btnElement.classList.remove('loading');
        showNotification(err.message, 'error');
        setTimeout(() => { btnElement.textContent = '🔊'; }, 3000);
      }
    }

    function stopTts() {
      if (currentTtsAudio) {
        currentTtsAudio.pause();
        currentTtsAudio.currentTime = 0;
        currentTtsAudio = null;
      }
      if (playingTtsBtn) {
        playingTtsBtn.textContent = '🔊';
        playingTtsBtn.classList.remove('playing', 'loading');
        playingTtsBtn = null;
      }
    }

    function addMessageToActiveSession(content, role, imagePath = null) {
      const session = chatSessions.get(activeChatSessionId);
      if (!session) return;

      session.messages.push({ role, content, timestamp: Date.now(), imagePath });

      if (session.id === activeChatSessionId) {
        appendMessageToContainer(content, role, imagePath);
        scrollToBottom();
      }
    }

    function scrollToBottom() {
      if (!chatMessagesContainer) return;

      // Use smooth scrolling for better UX
      chatMessagesContainer.scrollTo({
        top: chatMessagesContainer.scrollHeight,
        behavior: 'smooth'
      });

      // Fallback for browsers that don't support smooth scrolling
      setTimeout(() => {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      }, 50);
    }

    function deleteChatSession(sessionId) {
      const session = chatSessions.get(sessionId);
      if (!session) return;

      // Check if session has a serverSessionId
      if (!session.serverSessionId) {
        // Session not synced with server yet, just remove locally
        chatSessions.delete(sessionId);
        if (activeChatSessionId === sessionId) {
          const remaining = Array.from(chatSessions.keys());
          setActiveChatSession(remaining.length > 0 ? remaining[0] : null);
        }
        renderChatTabs();
        showNotification(`"${session.name}" deleted`, 'success');
        return;
      }

      // Use modern confirmation modal instead of browser confirm
      showConfirmationModal(
        'Delete Chat Session',
        `Are you sure you want to delete "${session.name}"? This action cannot be undone.`,
        () => {
          // Confirmed - proceed with deletion
          if (ws?.readyState === WebSocket.OPEN) {
            // Send both client sessionId and serverSessionId for proper deletion
            console.log('Sending delete request for session:', sessionId, 'serverSessionId:', session.serverSessionId);
            ws.send(JSON.stringify({
              type: 'chat_session_delete',
              sessionId: sessionId,
              serverSessionId: session.serverSessionId
            }));
          }

          // Remove from local map immediately for responsive UI
          chatSessions.delete(sessionId);

          if (activeChatSessionId === sessionId) {
            const remaining = Array.from(chatSessions.keys());
            setActiveChatSession(remaining.length > 0 ? remaining[0] : null);
          }

          renderChatTabs();
          showNotification(`"${session.name}" deleted`, 'success');
        }
      );
    }

    function renameChatSession() {
      const session = chatSessions.get(activeChatSessionId);
      if (!session) return;

      const newName = prompt('Enter new name:', session.name);
      if (newName && newName.trim()) {
        session.name = newName.trim();
        renderChatTabs();

        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'chat_session_rename',
            sessionId: session.id,
            name: session.name
          }));
        }

        updateHeaderForView('chat');
      }
    }

    function clearActiveSession() {
      const session = chatSessions.get(activeChatSessionId);
      if (!session) return;

      // Use modern confirmation modal instead of browser confirm
      showConfirmationModal(
        'Clear Chat History',
        `Are you sure you want to clear all messages in "${session.name}"? This cannot be undone.`,
        () => {
          // Confirmed - proceed with clearing
          session.messages = [];
          session.initialized = false;
          renderChatMessages(session);

          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'chat_session_clear',
              sessionId: session.id
            }));
          }

          updateChatStatus('offline');
          enableChatInput(false);
          showNotification(`"${session.name}" cleared`, 'success');
        }
      );
    }

    async function loadChatSessions() {
      // Prevent concurrent calls
      if (chatSessionsLoading) {
        console.log('Chat sessions already loading, skipping...');
        return;
      }

      // Prevent reloading if we already have sessions loaded
      if (chatSessions.size > 0) {
        console.log('Chat sessions already loaded, skipping...');
        return;
      }

      chatSessionsLoading = true;

      try {
        const response = await fetch('/api/chat/sessions?limit=10', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`Loaded ${data.sessions?.length || 0} chat sessions from server`);

          if (data.sessions && data.sessions.length > 0) {
            // Preserve local-only sessions that haven't been saved to server yet
            const localOnlySessions = [];
            chatSessions.forEach((session, id) => {
              if (!session.serverSessionId || session.initializing) {
                localOnlySessions.push({ id, session });
              }
            });

            // Clear any existing server sessions first to prevent duplicates
            chatSessions.clear();
            chatSessionCounter = 0;

            // Restore local-only sessions
            localOnlySessions.forEach(({ id, session }) => {
              chatSessions.set(id, session);
            });

            // Only load most recent 10 sessions to prevent clutter
            const sessionsToLoad = data.sessions.slice(0, 10);

            sessionsToLoad.forEach(serverSession => {
              // Generate client session ID from server session ID if available
              // Use a stable prefix so the ID is consistent across refreshes
              const clientSessionId = serverSession.serverSessionId
                ? `chat_${serverSession.serverSessionId}`
                : generateSessionId();
              const session = {
                id: clientSessionId,
                name: serverSession.name || 'Untitled Chat',
                model: serverSession.model || (availableModels.length > 0 ? availableModels[0].id : 'default'),
                agentEngine: 'pi-agent',
                messages: serverSession.messages
                  ? serverSession.messages
                      .filter(m => m.content && typeof m.content === 'string' && m.content.trim().length > 0)
                      .map(m => ({
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp || Date.now()
                      }))
                  : [],
                // FIX: Sessions from API need to re-connect to server
                // They have serverSessionId but need websocket registration
                initialized: false,
                initializing: false,
                serverSessionId: serverSession.serverSessionId,
                sdkSessionId: serverSession.sdkSessionId,
                workingDirectory: serverSession.workingDirectory || null,
                // NEW: Flag to indicate this is an existing session from DB
                _needsServerReconnect: !!serverSession.serverSessionId
              };
              chatSessions.set(clientSessionId, session);
            });

            renderChatTabs();

            // Don't auto-select first session - let user choose
            // This prevents auto-initialization which creates new server sessions
            showEmptyChatState();
          }
        }
      } catch (err) {
        console.error('Failed to load chat sessions:', err);
      } finally {
        chatSessionsLoading = false;
      }
    }

    // Fetch Ollama configuration from server and populate model select
    async function loadOllamaConfig() {
      try {
        const response = await fetch('/api/chat/status', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Ollama config from server:', data);

          // Load available providers and models
          await loadProviderConfig();
          await loadAvailableModels();
          await loadTtsVoices();

          // Show warning based on provider
          if (!data.ollamaConfigured && data.llmProvider === 'ollama') {
            console.warn('Ollama not configured');
            showChatError('Ollama not configured. Please check your launcher settings.');
          } else if (data.llmProvider === 'nvidia' && (!data.availableModels || data.availableModels.length === 0)) {
            console.warn('NVIDIA NIM not configured or unreachable');
            showChatError('NVIDIA NIM provider selected but no models available. Please check your NVIDIA API key in the launcher settings and restart the server.');
          }

          return data;
        }
      } catch (err) {
        console.error('Failed to load Ollama config:', err);
      }
      return null;
    }

    // Load available providers from server config
    async function loadProviderConfig() {
      try {
        if (!authToken) return;
        const response = await fetch('/api/chat/config', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          availableProviders = data.availableProviders || [];
          if (chatProviderSelect) {
            // Preserve current selection before clearing
            const previousSelection = chatProviderSelect.value;
            const wasDisabled = chatProviderSelect.disabled;

            chatProviderSelect.innerHTML = '';
            if (availableProviders.length === 0) {
              const option = document.createElement('option');
              option.value = '';
              option.textContent = 'No providers';
              chatProviderSelect.appendChild(option);
              chatProviderSelect.disabled = true;
            } else {
              availableProviders.forEach(p => {
                const providerId = typeof p === 'string' ? p : (p.id || '');
                const providerName = typeof p === 'string' ? p.charAt(0).toUpperCase() + p.slice(1) : (p.name || providerId);
                const option = document.createElement('option');
                option.value = providerId;
                option.textContent = providerName;
                chatProviderSelect.appendChild(option);
              });
              chatProviderSelect.disabled = wasDisabled;

              // Restore previous selection if it's still a valid option
              const validIds = Array.from(chatProviderSelect.options).map(o => o.value);
              if (previousSelection && validIds.includes(previousSelection)) {
                chatProviderSelect.value = previousSelection;
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to load provider config:', err);
      }
    }

    // Load available models from server
    async function loadAvailableModels(provider = null) {
      try {
        console.log('Loading available models...');

        // Check auth token
        if (!authToken) {
          console.warn('No auth token available, cannot load models');
          return;
        }

        const targetProvider = provider || chatProviderSelect?.value || 'ollama';
        const response = await fetch(`/api/chat/models?provider=${encodeURIComponent(targetProvider)}`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Available models:', data.models);

          availableModels = data.models || [];

          // Populate model select
          if (chatModelSelect) {
            // Save current selection before clearing
            const currentSelection = chatModelSelect.value;

            chatModelSelect.innerHTML = '';

            if (availableModels.length === 0) {
              console.warn('No models returned from server, chat may not work');
              const option = document.createElement('option');
              option.value = '';
              option.textContent = 'No models available - check provider config';
              chatModelSelect.appendChild(option);
              chatModelSelect.disabled = true;
            } else {
              availableModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.name || model.id;
                chatModelSelect.appendChild(option);
              });
              console.log(`Populated model selector with ${availableModels.length} models`);
              chatModelSelect.disabled = false;

              // Restore selection: prefer current value (in case user changed it during async load),
              // then fall back to the selection captured when loadAvailableModels started
              const modelIds = availableModels.map(m => m.id);
              const currentValue = chatModelSelect.value;
              if (currentValue && modelIds.includes(currentValue)) {
                chatModelSelect.value = currentValue;
              } else if (currentSelection && modelIds.includes(currentSelection)) {
                chatModelSelect.value = currentSelection;
              } else {
                // Try to get default from server, otherwise use first model
                const statusResponse = await fetch('/api/chat/status', {
                  headers: { 'Authorization': `Bearer ${authToken}` }
                });
                if (statusResponse.ok) {
                  const statusData = await statusResponse.json();
                  const providerDefault = statusData.llmProvider === 'ollama' ? statusData.ollamaModel :
                                         statusData.llmProvider === 'nvidia' ? (statusData.availableModels?.[0]?.id || statusData.availableModels?.[0]) :
                                         statusData.availableModels?.[0]?.id || statusData.availableModels?.[0];
                  if (providerDefault && modelIds.includes(providerDefault)) {
                    chatModelSelect.value = providerDefault;
                  } else {
                    chatModelSelect.value = availableModels[0]?.id || '';
                  }
                }
              }
            }
          }
        } else {
          console.error('Failed to load models:', response.status, response.statusText);
        }
      } catch (err) {
        console.error('Failed to load available models:', err);
      }
    }

    // Load available TTS voices from server
    async function loadTtsVoices() {
      try {
        if (!authToken) {
          console.warn('No auth token available, cannot load TTS voices');
          return;
        }

        const response = await fetch('/api/tts/voices', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
          const data = await response.json();
          const voices = data.voices || [];
          const voiceSelect = document.getElementById('ttsVoiceSelect');
          if (!voiceSelect) return;

          voiceSelect.innerHTML = '';
          if (voices.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Voice: default';
            voiceSelect.appendChild(option);
            voiceSelect.style.display = 'none';
          } else {
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Voice: default';
            voiceSelect.appendChild(defaultOption);

            voices.forEach(voice => {
              const option = document.createElement('option');
              option.value = voice.id;
              option.textContent = voice.name || voice.id;
              voiceSelect.appendChild(option);
            });

            const savedVoice = localStorage.getItem('ttsVoice') || '';
            if (savedVoice && voices.some(v => v.id === savedVoice)) {
              voiceSelect.value = savedVoice;
            }
            voiceSelect.style.display = 'block';
            console.log(`Populated TTS voice selector with ${voices.length} voices`);
          }
        } else {
          console.warn('Failed to load TTS voices:', response.status);
        }
      } catch (err) {
        console.error('Failed to load TTS voices:', err);
      }
    }

    // Persist selected voice
    const ttsVoiceSelect = document.getElementById('ttsVoiceSelect');
    if (ttsVoiceSelect) {
      ttsVoiceSelect.addEventListener('change', () => {
        localStorage.setItem('ttsVoice', ttsVoiceSelect.value);
      });
    }

    // Show chat error via notification toast instead of banner
    function showChatError(message) {
      if (message) {
        showNotification(message, 'error', null, 6000);
      }
    }

    // Hide chat error (no-op since we use toast notifications)
    function hideChatError() {
      // Notifications auto-dismiss; no persistent banner to hide
    }

    // Test connection to model
    async function testModelConnection() {
      if (!chatModelSelect) return;

      const model = chatModelSelect.value;
      if (!model) {
        showChatError('Please select a model first');
        return;
      }

      testConnectionBtn.disabled = true;
      testConnectionBtn.textContent = '⏳ Testing...';
      hideChatError();

      try {
        const response = await fetch('/api/chat/test-connection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ model })
        });

        const data = await response.json();

        if (data.success) {
          showNotification(`✅ Connection successful: ${data.provider} - ${model}`, 'success');
        } else {
          // Show detailed error with hint if available
          let errorMessage = data.message || 'Connection test failed';
          if (data.hint) {
            errorMessage += `\n\n💡 ${data.hint}`;
          }
          if (data.stage) {
            console.log('Connection failed at stage:', data.stage);
          }
          showChatError(errorMessage);
        }
      } catch (err) {
        showChatError('Connection test failed: ' + err.message);
      } finally {
        testConnectionBtn.disabled = false;
        testConnectionBtn.textContent = '🔗 Test';
      }
    }

    if (testConnectionBtn) {
      testConnectionBtn.addEventListener('click', testModelConnection);
    }

    function initializeChatSession(sessionId, workingDirectory = null) {
      if (!chatEnabled) {
        console.log('⏭️ initializeChatSession skipped: chat feature is disabled');
        return;
      }
      const session = chatSessions.get(sessionId);
      if (!session || session.initialized || session.initializing) {
        console.log(`⏭️ initializeChatSession skipped for ${sessionId}: initialized=${session?.initialized}, initializing=${session?.initializing}`);
        return;
      }

      session.initializing = true;
      console.log(`🚀 initializeChatSession started for ${sessionId}`);

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not connected, queueing session initialization:', sessionId);
        pendingSessionInit = { sessionId, workingDirectory };
        return;
      }

      // Clear any pending init since we're processing now
      pendingSessionInit = null;

      // Set a timeout to detect stuck connections
      if (session.initTimeout) {
        clearTimeout(session.initTimeout);
      }
      session.initTimeout = setTimeout(() => {
        if (!session.initialized) {
          console.warn(`Session ${sessionId} initialization timed out`);
          session.initializing = false;
          showChatError('Session initialization timed out. Please try refreshing the page.');
          updateChatStatus('offline');
        }
      }, 30000); // 30 second timeout

      // Check if this is a reconnect to an existing server session
      if (session.serverSessionId) {
        // Reconnecting to existing session - use reconnect flow
        console.log(`Reconnecting to existing session: ${session.serverSessionId}`);
        ws.send(JSON.stringify({
          type: 'chat_session_reconnect',
          sessionId: session.id,
          serverSessionId: session.serverSessionId,
          sdkSessionId: session.sdkSessionId,
          name: session.name,
          model: session.model,
          provider: session.provider,
          agentEngine: 'pi-agent',
          workingDirectory: session.workingDirectory || null
        }));
      } else {
        // New session - create on server
        console.log(`Creating new chat session: ${session.id}`);
        console.log(`WebSocket state: ${ws?.readyState} (OPEN=${WebSocket.OPEN})`);
        if (ws?.readyState === WebSocket.OPEN) {
          // Use passed workingDirectory or fall back to session's stored workingDirectory
          const effectiveWorkingDirectory = workingDirectory || session.workingDirectory;
          const message = {
            type: 'chat_session_create',
            sessionId: session.id,
            name: session.name,
            model: session.model,
            provider: session.provider,
            agentEngine: 'pi-agent',
            workingDirectory: effectiveWorkingDirectory
          };
          console.log('Sending WebSocket message:', message);
          ws.send(JSON.stringify(message));
          console.log('WebSocket message sent successfully');
        } else {
          console.error('WebSocket not open! State:', ws?.readyState);
        }
      }

      updateChatStatus('connecting');
    }

    function enableChatInput(enabled) {
      if (chatInput) {
        chatInput.disabled = !enabled;
        chatInput.placeholder = enabled
          ? 'Type your message... (Shift+Enter for new line)'
          : 'Chat not connected';
      }
      if (sendChatBtn) {
        sendChatBtn.disabled = !enabled;
      }
      if (uploadImageBtn) {
        uploadImageBtn.disabled = !enabled;
      }
    }

    function updateChatStatus(status) {
      if (!chatStatusBadge) return;

      // Remove all status classes
      chatStatusBadge.classList.remove('online', 'offline', 'connecting');

      // Add appropriate class and text
      switch (status) {
        case 'online':
          chatStatusBadge.classList.add('online');
          chatStatusBadge.textContent = 'Online';
          break;
        case 'offline':
          chatStatusBadge.classList.add('offline');
          chatStatusBadge.textContent = 'Offline';
          break;
        case 'connecting':
          chatStatusBadge.classList.add('connecting');
          chatStatusBadge.textContent = 'Connecting...';
          break;
        default:
          chatStatusBadge.classList.add('offline');
          chatStatusBadge.textContent = 'Offline';
      }
    }

    function sendChatMessage() {
      const message = chatInput?.value.trim();

      // Allow sending if there's a message or an image
      if (!message && !pendingImagePath) return;

      const session = chatSessions.get(activeChatSessionId);
      if (!session) {
        showNotification('Please create or select a chat session first.', 'warning');
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendMessageToContainer('Not connected to server.', 'error');
        return;
      }

      // Add user message to UI (with image if present)
      addMessageToActiveSession(message || '(Image attached)', 'user', pendingImagePath);

      // Clear input
      chatInput.value = '';
      chatInput.style.height = 'auto';

      // Store image path and clear upload UI
      const imagePathToSend = pendingImagePath;
      clearImageUpload();

      // Add typing indicator while waiting for response
      addTypingIndicator();
      incrementAgentWork();

      // If session not initialized, initialize it first and queue the message
      if (!session.initialized) {
        initializeChatSession(session.id);
        // Store pending message to send after initialization
        session.pendingMessage = message;
        session.pendingImagePath = imagePathToSend;
        updateChatStatus('connecting');
        return;
      }

      // Construct message content with image reference if present
      let messageContent = message || '';
      if (imagePathToSend) {
        // Include image path in the message for the agent to analyze
        if (messageContent) {
          messageContent += '\n\n';
        }
        messageContent += `[Image: ${imagePathToSend}]`;
      }

      ws.send(JSON.stringify({
        type: 'chat_send',
        sessionId: session.id,
        message: messageContent,
        model: chatModelSelect?.value || session.model,
        imagePath: imagePathToSend // Send image path separately for SDK processing
      }));
    }

    // Add typing/preparing indicator
    function addTypingIndicator() {
      removeTypingIndicator(); // Remove any existing

      const container = document.getElementById('chatMessagesContainer');
      if (!container) return;

      const indicator = document.createElement('div');
      indicator.id = 'typing-indicator';
      indicator.dataset.sessionId = activeChatSessionId;
      indicator.className = 'chat-message assistant typing-indicator';
      indicator.innerHTML = `
        <div class="message-avatar-header" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px;font-weight:600;opacity:0.8;color:var(--accent-secondary,#a78bfa)">
          <span>🤖</span><span>AI Assistant</span>
        </div>
        <div class="typing-bubble"></div>
        <span class="typing-text">Agent is working...</span>
      `;
      container.appendChild(indicator);
      scrollToBottom();
    }

    // Remove typing indicator
    function removeTypingIndicator(sessionId = null) {
      const indicator = document.getElementById('typing-indicator');
      // Guard: only remove if it still has the typing-indicator class
      // (belt-and-suspenders in case of race conditions)
      if (indicator && indicator.classList.contains('typing-indicator')) {
        // If sessionId is provided, only remove if this indicator belongs to that session
        if (sessionId && indicator.dataset.sessionId !== sessionId) {
          return;
        }
        indicator.remove();
      }
    }

    // Agent Working Indicator
    function showAgentWorkingIndicator() {
      agentWorkingCount++;
      const el = document.getElementById('agentWorkingIndicator');
      if (el) el.style.display = 'flex';
      const banner = document.getElementById('chatWorkingBanner');
      if (banner) banner.style.display = 'flex';
    }
    function hideAgentWorkingIndicator() {
      agentWorkingCount = Math.max(0, agentWorkingCount - 1);
      if (agentWorkingCount === 0) {
        const el = document.getElementById('agentWorkingIndicator');
        if (el) el.style.display = 'none';
        const banner = document.getElementById('chatWorkingBanner');
        if (banner) banner.style.display = 'none';
      }
    }
    function resetAgentWorkingIndicator() {
      agentWorkingCount = 0;
      const el = document.getElementById('agentWorkingIndicator');
      if (el) el.style.display = 'none';
      const banner = document.getElementById('chatWorkingBanner');
      if (banner) banner.style.display = 'none';
    }

    // Alias functions for legacy call sites (fixes "Preparing response..." hang)
    function incrementAgentWork() { showAgentWorkingIndicator(); }
    function decrementAgentWork() { hideAgentWorkingIndicator(); }
    // Event Handlers
    viewTerminalBtn?.addEventListener('click', showTerminalView);
    viewChatBtn?.addEventListener('click', showChatView);
    newChatSessionBtn?.addEventListener('click', () => createChatSession());
    startNewChatBtn?.addEventListener('click', () => createChatSession());
    renameChatSessionBtn?.addEventListener('click', renameChatSession);
    clearChatSessionBtn?.addEventListener('click', clearActiveSession);
    deleteChatSessionBtn?.addEventListener('click', () => {
      if (activeChatSessionId) deleteChatSession(activeChatSessionId);
    });

    // ===========================
    // Mobile More Menu Toggle
    // ===========================
    function closeAllMobileMenus() {
      document.querySelectorAll('.mobile-more-group.show, .chat-more-menu.show').forEach(g => g.classList.remove('show'));
      document.querySelectorAll('.mobile-more-btn.active, .btn-icon.active').forEach(b => b.classList.remove('active'));
    }

    function toggleMobileMenu(btn, group) {
      const isOpen = group.classList.contains('show');
      closeAllMobileMenus();
      if (!isOpen) {
        group.classList.add('show');
        btn.classList.add('active');
      }
    }

    document.getElementById('terminalMoreBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileMenu(
        document.getElementById('terminalMoreBtn'),
        document.getElementById('terminalMoreGroup')
      );
    });

    document.getElementById('chatMoreBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileMenu(
        document.getElementById('chatMoreBtn'),
        document.getElementById('chatMoreGroup')
      );
    });

    // Mobile chat menu button handlers - close menu after action
    document.getElementById('mbTestConnection')?.addEventListener('click', () => { closeAllMobileMenus(); testModelConnection(); });
    document.getElementById('mbShowHistory')?.addEventListener('click', () => { closeAllMobileMenus();
      const panel = document.getElementById('sessionHistoryPanel');
      if (panel && panel.style.display === 'block') { hideSessionHistoryPanel(); } else { showSessionHistoryPanel(); }
    });
    document.getElementById('mbNewChatSession')?.addEventListener('click', () => { closeAllMobileMenus(); createChatSession(); });
    document.getElementById('mbCloseAllSessions')?.addEventListener('click', () => { closeAllMobileMenus();
      showConfirmationModal('Close All Chat Sessions', 'Are you sure you want to close all chat sessions? This will delete all conversations.', () => { closeAllChatSessions(); });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.mobile-more-btn') && !e.target.closest('.mobile-more-group') &&
          !e.target.closest('.btn-icon') && !e.target.closest('.chat-more-menu')) {
        closeAllMobileMenus();
      }
    });

    // Show Chat History Button
    document.getElementById('showHistoryBtn')?.addEventListener('click', () => {
      const panel = document.getElementById('sessionHistoryPanel');
      if (panel && panel.style.display === 'block') {
        hideSessionHistoryPanel();
      } else {
        showSessionHistoryPanel();
      }
    });

    // Close All Chat Sessions Button
    document.getElementById('closeAllChatSessionsBtn')?.addEventListener('click', () => {
      showConfirmationModal(
        'Close All Chat Sessions',
        'Are you sure you want to close all chat sessions? This will delete all conversations.',
        () => {
          closeAllChatSessions();
        }
      );
    });
    sendChatBtn?.addEventListener('click', sendChatMessage);

    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    chatInput?.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });

    // Auto-refresh model list when dropdown is clicked (to show newly downloaded models)
    chatModelSelect?.addEventListener('mousedown', async function() {
      console.log('🔄 Refreshing model list from Ollama...');
      const currentProvider = chatProviderSelect?.value;
      await loadProviderConfig();
      await loadAvailableModels(currentProvider);
      await loadTtsVoices();
    });

    // Also refresh when dropdown receives focus
    chatModelSelect?.addEventListener('focus', async function() {
      console.log('🔄 Refreshing model list on focus...');
      const currentProvider = chatProviderSelect?.value;
      await loadProviderConfig();
      await loadAvailableModels(currentProvider);
      await loadTtsVoices();
    });

    // Sync selected model to active session when user changes it
    chatModelSelect?.addEventListener('change', function() {
      const session = chatSessions.get(activeChatSessionId);
      if (session) {
        session.model = chatModelSelect.value;
        console.log('🔄 Model changed for session:', session.id, '->', session.model);
      }
    });

    // Provider change: reload models for the selected provider
    chatProviderSelect?.addEventListener('change', async function() {
      const newProvider = chatProviderSelect.value;
      console.log('🔄 Provider changed to:', newProvider);
      await loadAvailableModels(newProvider);
      const session = chatSessions.get(activeChatSessionId);
      if (session) {
        session.provider = newProvider;
        // Pick first available model for the new provider
        if (availableModels.length > 0) {
          session.model = availableModels[0].id;
          if (chatModelSelect) chatModelSelect.value = session.model;
        }
      }
    });

    // Sync selected agent engine to active session


    // Image Upload Event Listeners
    uploadImageBtn?.addEventListener('click', () => {
      imageUploadInput?.click();
    });

    imageUploadInput?.addEventListener('change', handleImageUpload);

    removeImageBtn?.addEventListener('click', clearImageUpload);

    async function handleImageUpload(e) {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file is an image
      if (!file.type.startsWith('image/')) {
        showNotification('Please select an image file', 'error');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        showNotification('Image file too large (max 10MB)', 'error');
        return;
      }

      pendingImageFile = file;

      // Show preview
      const reader = new FileReader();
      reader.onload = (event) => {
        if (imagePreview) {
          imagePreview.src = event.target.result;
        }
        if (imagePreviewName) {
          imagePreviewName.textContent = file.name;
        }
        if (imageUploadPreview) {
          imageUploadPreview.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);

      // Upload image to server
      await uploadImageToServer(file);
    }

    async function uploadImageToServer(file) {
      const session = chatSessions.get(activeChatSessionId);
      if (!session) {
        showNotification('Please select a chat session first', 'warning');
        return;
      }

      // Get working directory from session or use current directory
      const workingDirectory = session.workingDirectory || currentPath;

      const formData = new FormData();
      formData.append('image', file);
      formData.append('workingDirectory', workingDirectory);

      try {
        const response = await fetch('/api/upload-image', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`
          },
          body: formData
        });

        if (!response.ok) {
          throw new Error('Failed to upload image');
        }

        const result = await response.json();
        pendingImagePath = result.imagePath;

        showNotification('Image uploaded successfully', 'success');
      } catch (err) {
        console.error('Image upload error:', err);
        showNotification('Failed to upload image: ' + err.message, 'error');
        clearImageUpload();
      }
    }

    function clearImageUpload() {
      pendingImageFile = null;
      pendingImagePath = null;
      if (imageUploadInput) {
        imageUploadInput.value = '';
      }
      if (imageUploadPreview) {
        imageUploadPreview.style.display = 'none';
      }
      if (imagePreview) {
        imagePreview.src = '';
      }
      if (imagePreviewName) {
        imagePreviewName.textContent = '';
      }
    }

    function handleChatMessage(data) {
      console.log('📨 handleChatMessage received:', data.type, data);
      switch (data.type) {
        case 'chat_session_created':
          const createdSession = chatSessions.get(data.clientSessionId);
          if (createdSession) {
            // Clear initialization timeout
            if (createdSession.initTimeout) {
              clearTimeout(createdSession.initTimeout);
              createdSession.initTimeout = null;
            }

            createdSession.serverSessionId = data.serverSessionId;
            createdSession.sdkSessionId = data.sdkSessionId;
            createdSession.agentEngine = 'pi-agent';
            createdSession.initializing = false;
            createdSession.initialized = true;

            // Sync provider/model from server response
            if (data.provider) {
              createdSession.provider = data.provider;
              if (chatProviderSelect && activeChatSessionId === data.clientSessionId) {
                if (Array.from(chatProviderSelect.options).some(o => o.value === data.provider)) {
                  chatProviderSelect.value = data.provider;
                }
              }
            }
            if (data.model) {
              createdSession.model = data.model;
              if (chatModelSelect && activeChatSessionId === data.clientSessionId) {
                chatModelSelect.value = data.model;
              }
            }

            // Remove any duplicate sessions with the same serverSessionId
            // CRITICAL: Don't remove sessions that have active streaming
            chatSessions.forEach((session, id) => {
              if (id !== data.clientSessionId && session.serverSessionId === data.serverSessionId) {
                // Check if this session has active streaming before deleting
                if (streamingMessages.has(id)) {
                  console.log('[chat_session_created] SKIPPING delete of streaming session:', id);
                  return;
                }
                console.log('Removing duplicate session with same serverSessionId:', id, '->', data.clientSessionId);
                chatSessions.delete(id);
              }
            });

            // Re-save active session now that we have a stable serverSessionId
            if (activeChatSessionId === data.clientSessionId) {
              saveActiveChatSession(data.clientSessionId);
            }

            // Store working directory if provided
            if (data.workingDirectory) {
              createdSession.workingDirectory = data.workingDirectory;
            }

            if (data.history && data.history.length > 0) {
              createdSession.messages = data.history.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp || Date.now()
              }));
            }

            if (activeChatSessionId === data.clientSessionId) {
              // CRITICAL: Skip ALL re-rendering if ANY stream is active
              if (streamingMessages.size > 0) {
                console.log('[chat_session_created] SKIPPING all updates - active stream in progress');
                // Still update status
                updateChatStatus('online');
                enableChatInput(true);
              } else if (!streamingMessages.has(data.clientSessionId)) {
                renderChatMessages(createdSession);
                updateChatStatus('online');
                enableChatInput(true);
              }

              // Show mode indicator
              const modeIndicator = document.getElementById('chatModeIndicator');
              if (modeIndicator) {
                modeIndicator.style.display = 'inline-flex';
                modeIndicator.textContent = 'Interactive Mode';
                modeIndicator.className = 'mode-indicator interactive';
              }

              // Show welcome message with working directory context
              // Only show for truly NEW sessions (no history), not reconnections
              if (data.workingDirectory && (!data.history || data.history.length === 0)) {
                // Check if we've already shown welcome for this session
                const welcomeShownKey = `welcome_shown_${data.clientSessionId}`;
                if (!sessionStorage.getItem(welcomeShownKey)) {
                  sessionStorage.setItem(welcomeShownKey, 'true');
                  setTimeout(() => {
                    addMessageToActiveSession(
                      `👋 Welcome! I'm ready to help you with this project.

📁 **Working Directory:** \`${data.workingDirectory}\`

You can ask me anything about the code, request modifications, or upload images for analysis.`,
                      'assistant');
                  }, 100);
                }
              }

              // Send pending message if exists
              if (createdSession.pendingMessage || createdSession.pendingImagePath) {
                let messageContent = createdSession.pendingMessage || '';
                if (createdSession.pendingImagePath) {
                  if (messageContent) {
                    messageContent += '\n\n';
                  }
                  messageContent += `[Image: ${createdSession.pendingImagePath}]`;
                }

                ws.send(JSON.stringify({
                  type: 'chat_send',
                  sessionId: createdSession.id,
                  message: messageContent,
                  model: chatModelSelect?.value || createdSession.model,
                  imagePath: createdSession.pendingImagePath
                }));
                createdSession.pendingMessage = null;
                createdSession.pendingImagePath = null;
              } else {
                addMessageToActiveSession('Chat session initialized. How can I help?', 'system');
              }
            }
          }
          break;

        case 'chat_message_sent':
          // Message was queued or sent
          if (data.queued) {
            // Show visual indicator that message is queued
            showNotification('Message queued - will be sent after current response', 'info', null, 2000);
          }
          break;

        case 'chat_session_deleted':
          // Server confirmed deletion - session already removed from local map
          console.log(`Chat session deleted: ${data.clientSessionId}`);
          break;

        case 'chat_message':
          if (data.role === 'assistant') {
            // Skip empty/undefined assistant messages to avoid blank history bubbles
            if (!data.content || (typeof data.content === 'string' && data.content.trim().length === 0)) {
              console.log('[chat_message] Skipping empty assistant message for session', data.sessionId);
              removeTypingIndicator(data.sessionId);
              break;
            }

            // Remove typing indicator when response arrives
            removeTypingIndicator(data.sessionId);

            const targetSession = Array.from(chatSessions.values())
              .find(s => s.serverSessionId === data.sessionId || s.id === data.sessionId);

            console.log('[chat_message] assistant msg for', data.sessionId, 'content:', data.content.substring(0, 40));

            if (targetSession) {
              if (!Array.isArray(targetSession.messages)) targetSession.messages = [];
              // Prevent duplicate history entries if the last message already matches
              const lastMsg = targetSession.messages[targetSession.messages.length - 1];
              const isDuplicate = lastMsg && lastMsg.role === 'assistant' && lastMsg.content === data.content;

              if (!isDuplicate) {
                targetSession.messages.push({
                  role: 'assistant',
                  content: data.content,
                  timestamp: Date.now()
                });
              }

              if (targetSession.id === activeChatSessionId) {
                // Check if stream just completed - if so, the message is already displayed
                const streamJustCompleted = targetSession._lastStreamCompleteTime &&
                  (Date.now() - targetSession._lastStreamCompleteTime) < 1000;

                if (streamJustCompleted) {
                  console.log('[chat_message] Stream just completed, skipping duplicate render');
                  break;
                }

                // Check if we have an active streaming bubble for this session
                const streamEl = streamingMessages.get(data.sessionId);
                if (streamEl) {
                  // Update the streaming message with final formatted content
                  const contentDiv = streamEl.querySelector('.message-content');
                  if (contentDiv) {
                    contentDiv.innerHTML = formatMarkdown(data.content);
                  }
                  // Remove streaming class
                  streamEl.classList.remove('streaming');
                  streamingMessages.delete(data.sessionId);
                } else {
                  // No streaming bubble - check if the last assistant bubble in the DOM
                  // was just finalized and needs its content updated instead of creating a duplicate
                  const container = document.getElementById('chatMessagesContainer');
                  const lastBubble = container ? container.querySelector('.chat-message.assistant:last-child') : null;
                  const lastContent = lastBubble ? lastBubble.querySelector('.message-content') : null;
                  const lastText = lastContent ? lastContent.textContent : '';
                  const isRecent = lastBubble && (Date.now() - (lastBubble.dataset.timestamp || 0) < 2000);
                  // If the last bubble is very recent and already has the same text, skip creating a duplicate
                  if (isDuplicate || (isRecent && lastText === data.content)) {
                    // Skip - already present in history or DOM
                  } else if (lastBubble && isRecent && lastText !== data.content) {
                    // Last bubble is recent but content differs (e.g. accumulated deltas vs final)
                    // Update the existing bubble instead of creating a new one
                    if (lastContent) {
                      lastContent.innerHTML = formatMarkdown(data.content);
                    }
                  } else {
                    // No streaming bubble and not a duplicate history entry → create new bubble
                    appendMessageToContainer(data.content, 'assistant');
                  }
                }
                scrollToBottom();
              }
            }
            // Re-enable input after receiving a complete assistant message
            updateChatStatus('online');
            enableChatInput(true);
          }
          break;

        case 'chat_provider_changed':
          {
            const s = chatSessions.get(data.sessionId);
            if (s) {
              s.provider = data.provider;
              s.model = data.model;
              if (chatProviderSelect) chatProviderSelect.value = data.provider;
              if (chatModelSelect) chatModelSelect.value = data.model;
            }
            showNotification(data.message || `Switched to ${data.provider} provider`, 'warning');
          }
          break;

        case 'chat_error':
          // Remove typing indicator on error
          removeTypingIndicator();
          decrementAgentWork();

          // Clear any pending initialization timeouts
          chatSessions.forEach(session => {
            if (session.initTimeout) {
              clearTimeout(session.initTimeout);
              session.initTimeout = null;
            }
          });

          // Check for limit-related errors and show as a friendly bubble
          const lowerMsg = (data.message || '').toLowerCase();
          const isLimit = lowerMsg.includes('too many requests') ||
                        lowerMsg.includes('capacity') ||
                        lowerMsg.includes('quota') ||
                        lowerMsg.includes('overloaded');

          if (isLimit) {
            appendMessageToContainer(data.message, 'system');
          } else {
            appendMessageToContainer(data.message || 'Chat error', 'error');
          }

          showChatError(data.message || 'Chat error occurred');

          // Don't permanently disable input for all errors.
          // Only hard-disable for auth/connection errors. For transient errors
          // (rate limits, timeouts, provider hiccups), allow retry after a short delay.
          const lowerErrMsg = (data.message || '').toLowerCase();
          const isHardError = lowerErrMsg.includes('not authenticated') ||
                              lowerErrMsg.includes('not connected') ||
                              lowerErrMsg.includes('not initialized') ||
                              lowerErrMsg.includes('failed to initialize');

          if (isHardError) {
            updateChatStatus('offline');
            enableChatInput(false);
          } else {
            // Transient error - show offline briefly then auto-recover
            updateChatStatus('offline');
            enableChatInput(false);
            setTimeout(() => {
              updateChatStatus('online');
              enableChatInput(true);
            }, 3000);
          }
          break;

        case 'permission_request':
          handlePermissionRequest(data);
          break;

        case 'user_input_request':
          handleUserInputRequest(data);
          break;

        case 'command_result':
          handleCommandResult(data);
          break;

        case 'tool_start':
          handleToolStart(data);
          break;

        case 'tool_progress':
          handleToolProgress(data);
          break;

        case 'tool_complete':
          handleToolComplete(data);
          break;

        case 'mode_changed':
          handleModeChanged(data);
          break;

        case 'chat_stream_delta':
          handleStreamDelta(data);
          break;

        case 'chat_stream_complete':
          handleStreamComplete(data);
          break;

        case 'chat_idle':
          // Legacy completion event - treat same as stream complete
          handleStreamComplete(data);
          break;

        case 'chat_reasoning':
          handleReasoning(data);
          break;

        case 'chat_reasoning_delta':
          handleReasoningDelta(data);
          break;

        case 'plan_update':
          handlePlanUpdate(data);
          break;

        case 'agent_status':
          handleAgentStatus(data);
          break;

        case 'agent_thinking':
          handleAgentThinking(data);
          break;

        case 'interrupt_success':
          showNotification('Operation interrupted', 'info');
          break;

        case 'session_info':
          console.log('Session info received:', data);
          break;

        case 'session_resumed':
          handleSessionResumed(data);
          break;

        case 'token_usage_update':
          handleTokenUsageUpdate(data);
          break;

        case 'subagent_started':
          incrementAgentWork();
          break;

        case 'subagent_completed':
          decrementAgentWork();
          break;
      }
    }

    // ===============================
    // Modern Notification System
    // ===============================

    function showNotification(message, type = 'info', title = null, duration = 5000) {
      const container = document.getElementById('notificationContainer');
      if (!container) return;

      const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'i️'
      };

      const titles = {
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Info'
      };

      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.innerHTML = `
        <span class="notification-icon">${icons[type] || icons.info}</span>
        <div class="notification-content">
          <div class="notification-title">${title || titles[type] || titles.info}</div>
          <div class="notification-message">${message}</div>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">&times;</button>
      `;

      container.appendChild(notification);

      // Auto remove after duration
      if (duration > 0) {
        setTimeout(() => {
          notification.classList.add('hide');
          setTimeout(() => notification.remove(), 300);
        }, duration);
      }

      return notification;
    }

    // ===============================
    // Modern Confirmation Modal
    // ===============================

    let confirmModalResolve = null;

    function showConfirmationModal(title, message, onConfirm, onCancel = null) {
      const modal = document.getElementById('confirmModal');
      const titleEl = document.getElementById('confirmModalTitle');
      const messageEl = document.getElementById('confirmModalMessage');
      const confirmBtn = document.getElementById('confirmModalConfirm');
      const cancelBtn = document.getElementById('confirmModalCancel');

      if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
        // Fallback to browser confirm if modal not found
        if (confirm(message)) {
          onConfirm?.();
        } else {
          onCancel?.();
        }
        return;
      }

      titleEl.textContent = title;
      messageEl.textContent = message;

      // Store callbacks
      confirmModalResolve = { confirm: onConfirm, cancel: onCancel };

      // Show modal
      modal.classList.add('show');

      // Handle confirm
      const handleConfirm = () => {
        modal.classList.remove('show');
        confirmModalResolve?.confirm?.();
        cleanup();
      };

      // Handle cancel
      const handleCancel = () => {
        modal.classList.remove('show');
        confirmModalResolve?.cancel?.();
        cleanup();
      };

      // Cleanup function
      const cleanup = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleOverlayClick);
      };

      // Handle overlay click
      const handleOverlayClick = (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      modal.addEventListener('click', handleOverlayClick);
    }

    // ===============================
    // Close All Chat Sessions
    // ===============================

    async function closeAllChatSessions() {
      const sessionsToDelete = Array.from(chatSessions.keys());

      if (sessionsToDelete.length === 0) {
        showNotification('No chat sessions to close', 'info');
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      // Delete all sessions
      for (const sessionId of sessionsToDelete) {
        try {
          const session = chatSessions.get(sessionId);

          // Send delete request to server
          if (ws?.readyState === WebSocket.OPEN && session?.serverSessionId) {
            ws.send(JSON.stringify({
              type: 'chat_session_delete',
              sessionId: sessionId,
              serverSessionId: session.serverSessionId
            }));
          }

          // Remove from local map
          chatSessions.delete(sessionId);
          successCount++;
        } catch (err) {
          console.error(`Failed to delete session ${sessionId}:`, err);
          errorCount++;
        }
      }

      // Reset active session
      activeChatSessionId = null;

      // Update UI
      renderChatTabs();
      showEmptyChatState();

      // Show notification
      if (errorCount === 0) {
        showNotification(`Closed ${successCount} chat session${successCount !== 1 ? 's' : ''}`, 'success');
      } else {
        showNotification(`Closed ${successCount} sessions, ${errorCount} failed`, 'warning');
      }
    }

    // ===============================
    // Chat Tab Context Menu
    // ===============================

    function showChatTabContextMenu(event, sessionId) {
      // Remove any existing context menu
      const existingMenu = document.getElementById('chatTabContextMenu');
      if (existingMenu) {
        existingMenu.remove();
      }

      const session = chatSessions.get(sessionId);
      if (!session) return;

      // Create context menu
      const menu = document.createElement('div');
      menu.id = 'chatTabContextMenu';
      menu.className = 'context-menu';

      // Compute initial position
      let menuTop = event.clientY;
      let menuLeft = event.clientX;
      menu.style.top = `${menuTop}px`;
      menu.style.left = `${menuLeft}px`;

      // Build header with session name and working directory
      const headerHtml = session.workingDirectory
        ? `<div class="context-menu-header">
            <div class="context-menu-header-title">${escapeHtml(session.name)}</div>
            <div class="context-menu-header-path">📁 ${escapeHtml(session.workingDirectory)}</div>
           </div>`
        : '';

      menu.innerHTML = `
        ${headerHtml}
        <div class="context-menu-item" data-action="rename">
          <span>✏️</span> Rename
        </div>
        <div class="context-menu-item" data-action="duplicate">
          <span>📋</span> Duplicate
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item danger" data-action="close">
          <span>❌</span> Close This Session
        </div>
        <div class="context-menu-item danger" data-action="close-all">
          <span>🗑️</span> Close All Sessions
        </div>
      `;

      // Handle menu item clicks
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (!item) return;

        const action = item.dataset.action;
        menu.remove();

        switch (action) {
          case 'rename':
            renameChatSession();
            break;
          case 'duplicate':
            const originalSession = chatSessions.get(sessionId);
            if (originalSession) {
              createChatSession(`${originalSession.name} (Copy)`, originalSession.model);
            }
            break;
          case 'close':
            deleteChatSession(sessionId);
            break;
          case 'close-all':
            showConfirmationModal(
              'Close All Chat Sessions',
              `Are you sure you want to close all ${chatSessions.size} chat session${chatSessions.size !== 1 ? 's' : ''}?`,
              () => closeAllChatSessions()
            );
            break;
        }
      });

      // Close menu when clicking outside
      const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
          document.removeEventListener('scroll', closeMenu);
        }
      };

      document.body.appendChild(menu);

      // Adjust position if menu goes off screen
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        menuLeft = window.innerWidth - rect.width - 8;
      }
      if (rect.bottom > window.innerHeight - 8) {
        menuTop = window.innerHeight - rect.height - 8;
      }
      if (menuLeft < 8) menuLeft = 8;
      if (menuTop < 8) menuTop = 8;
      menu.style.top = `${menuTop}px`;
      menu.style.left = `${menuLeft}px`;

      // Delay adding click listener to avoid immediate close
      setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('scroll', closeMenu);
      }, 100);
    }

    // ===============================
    // Permission Request Handler
    // ===============================

    function handlePermissionRequest(data) {
      const { requestId, permission, description } = data;

      // Close any existing permission modals to prevent duplicates
      document.querySelectorAll('.permission-modal').forEach(m => m.remove());

      // Create permission request modal
      const modal = document.createElement('div');
      modal.className = 'permission-modal';
      modal.innerHTML = `
        <div class="permission-modal-content">
          <div class="permission-modal-header">
            <span class="permission-icon">🔐</span>
            <h3>Permission Request</h3>
          </div>
          <div class="permission-modal-body">
            <p class="permission-description">${description || `The agent is requesting permission to: ${typeof permission === 'object' ? (permission.kind || JSON.stringify(permission)) : permission}`}</p>
            ${data.details ? `<div class="permission-details"><pre>${JSON.stringify(data.details, null, 2)}</pre></div>` : ''}
          </div>
          <div class="permission-modal-actions">
            <button class="btn btn-danger permission-deny">Deny</button>
            <button class="btn btn-success permission-approve">Approve</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const closeModal = () => {
        if (modal && modal.parentNode) {
          modal.remove();
        }
      };

      // ESC key to close
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'permission_response',
              requestId,
              approved: false
            }));
          }
          closeModal();
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);

      // Click outside content to close
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'permission_response',
              requestId,
              approved: false
            }));
          }
          closeModal();
          document.removeEventListener('keydown', escHandler);
        }
      });

      // Handle button clicks
      modal.querySelector('.permission-approve').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'permission_response',
            requestId,
            approved: true
          }));
        }
        closeModal();
        document.removeEventListener('keydown', escHandler);
      });

      modal.querySelector('.permission-deny').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'permission_response',
            requestId,
            approved: false
          }));
        }
        closeModal();
        document.removeEventListener('keydown', escHandler);
      });
    }

    // ===============================
    // User Input Request Handler
    // ===============================

    function handleUserInputRequest(data) {
      const { requestId, prompt, placeholder } = data;

      // Create user input modal
      const modal = document.createElement('div');
      modal.className = 'user-input-modal';
      modal.innerHTML = `
        <div class="user-input-modal-content">
          <div class="user-input-modal-header">
            <span class="user-input-icon">💬</span>
            <h3>Input Required</h3>
          </div>
          <div class="user-input-modal-body">
            <p class="user-input-prompt">${prompt}</p>
            <textarea class="user-input-field" placeholder="${placeholder || 'Enter your response...'}" rows="4"></textarea>
          </div>
          <div class="user-input-modal-actions">
            <button class="btn btn-secondary user-input-cancel">Cancel</button>
            <button class="btn btn-primary user-input-submit">Submit</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const inputField = modal.querySelector('.user-input-field');
      inputField.focus();

      // Handle submit
      const submit = () => {
        const value = inputField.value.trim();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'user_input_response',
            requestId,
            value
          }));
        }
        modal.remove();
      };

      modal.querySelector('.user-input-submit').addEventListener('click', submit);
      inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      });

      modal.querySelector('.user-input-cancel').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'user_input_response',
            requestId,
            value: ''
          }));
        }
        modal.remove();
      });
    }

    // ===============================
    // Command Result Handler
    // ===============================

    function handleCommandResult(data) {
      const { command, success, message } = data;

      const statusType = success ? 'success' : 'error';
      const icon = success ? '✅' : '❌';

      // Remove any pending command indicators
      const container = document.getElementById('chatMessagesContainer');
      if (container) {
        container.querySelectorAll('.chat-message.system.pending-command').forEach(el => el.remove());
      }

      // Add command result to chat
      if (container) {
        const div = document.createElement('div');
        div.className = `chat-message system ${statusType}`;
        div.innerHTML = `
          <div class="message-content" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="command-icon">${icon}</span>
            <span class="command-name">${command}</span>
            <span class="command-message">${message}</span>
          </div>
        `;
        container.appendChild(div);
        scrollToBottom();
      }

      // Persist result in session history so it survives re-renders
      const session = chatSessions.get(activeChatSessionId);
      if (session) {
        session.messages.push({
          role: 'system',
          content: `${icon} ${command}: ${message}`,
          timestamp: Date.now()
        });
      }

      // Also show notification
      showNotification(message, statusType, command);
    }

    // ===============================
    // Tool Execution Handlers
    // ===============================

    const activeTools = new Map();

    function handleToolStart(data) {
      const { toolId, name, description } = data;

      // Create tool execution indicator
      const container = document.getElementById('chatMessagesContainer');
      if (container) {
        const div = document.createElement('div');
        div.className = 'chat-message tool-execution';
        div.id = `tool-${toolId}`;
        div.innerHTML = `
          <div class="tool-indicator">
            <div class="tool-spinner"></div>
            <div class="tool-info">
              <span class="tool-name">${name}</span>
              <span class="tool-description">${description || ''}</span>
            </div>
          </div>
        `;
        container.appendChild(div);
        scrollToBottom();

        activeTools.set(toolId, { name, description, element: div });
      }
    }

    function handleToolComplete(data) {
      const { toolId, result, success } = data;

      const toolData = activeTools.get(toolId);
      if (toolData) {
        const element = toolData.element;
        if (element) {
          element.classList.remove('tool-execution');
          element.classList.add('tool-complete', success ? 'success' : 'error');
          element.innerHTML = `
            <div class="tool-result">
              <span class="tool-icon">${success ? '✅' : '❌'}</span>
              <span class="tool-name">${escapeHtml(toolData.name)}</span>
            </div>
          `;
          if (result) {
            const outputDiv = document.createElement('div');
            outputDiv.className = 'tool-output';
            outputDiv.textContent = stripAnsiCodes(result);
            element.querySelector('.tool-result').appendChild(outputDiv);
          }
        }
        activeTools.delete(toolId);
      }
    }

    function handleToolProgress(data) {
      const { toolId, progress } = data;

      const toolData = activeTools.get(toolId);
      if (toolData && toolData.element) {
        const progressEl = toolData.element.querySelector('.tool-description');
        if (progressEl) {
          progressEl.textContent = progress || 'Running...';
        }
      }
    }

    // ===============================
    // Agent Status Handler (TUI-like activity display)
    // ===============================

    // Track current agent activity per session
    const agentActivityMessages = new Map();

    function handleAgentStatus(data) {
      const { sessionId, status, message } = data;
      
      // Only show for active session
      if (sessionId !== activeChatSessionId) return;
      
      const container = document.getElementById('chatMessagesContainer');
      if (!container) return;

      // Find or create agent activity indicator
      let activityEl = document.getElementById(`agent-activity-${sessionId}`);
      
      if (!activityEl) {
        activityEl = document.createElement('div');
        activityEl.className = 'chat-message agent-activity';
        activityEl.id = `agent-activity-${sessionId}`;
        container.appendChild(activityEl);
        scrollToBottom();
      }

      // Update the activity message
      activityEl.innerHTML = `
        <div class="agent-activity-indicator">
          <span class="agent-spinner">⚙️</span>
          <span class="agent-status-text">${escapeHtml(message || 'Agent is working...')}</span>
        </div>
      `;

      agentActivityMessages.set(sessionId, { element: activityEl, message });
    }

    function handleAgentThinking(data) {
      const { sessionId, delta } = data;
      
      // Only show for active session and if we have content
      if (sessionId !== activeChatSessionId || !delta) return;
      
      const container = document.getElementById('chatMessagesContainer');
      if (!container) return;

      // Find or create thinking indicator
      let thinkingEl = document.getElementById(`agent-thinking-${sessionId}`);
      
      if (!thinkingEl) {
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'chat-message agent-thinking';
        thinkingEl.id = `agent-thinking-${sessionId}`;
        container.appendChild(thinkingEl);
        scrollToBottom();
      }

      // Accumulate thinking text
      const currentText = thinkingEl.dataset.thinkingText || '';
      const newText = currentText + delta;
      thinkingEl.dataset.thinkingText = newText;

      // Show latest thinking with collapse for long content
      const lines = newText.split('\n').filter(l => l.trim());
      const displayText = lines.slice(-3).join('\n'); // Show last 3 lines
      
      thinkingEl.innerHTML = `
        <div class="agent-thinking-indicator">
          <span class="thinking-label">🤔 Thinking:</span>
          <span class="thinking-content">${escapeHtml(displayText)}</span>
          ${lines.length > 3 ? `<span class="thinking-more">+${lines.length - 3} more lines</span>` : ''}
        </div>
      `;
    }

    // Clean up agent activity when stream completes
    function removeAgentActivity(sessionId) {
      const activityEl = document.getElementById(`agent-activity-${sessionId}`);
      if (activityEl) {
        activityEl.remove();
      }
      const thinkingEl = document.getElementById(`agent-thinking-${sessionId}`);
      if (thinkingEl) {
        thinkingEl.remove();
      }
      agentActivityMessages.delete(sessionId);
    }

    // ===============================
    // Mode Change Handler
    // ===============================

    function handleModeChanged(data) {
      const { mode } = data;

      // Update mode indicator
      const modeIndicator = document.getElementById('chatModeIndicator');
      if (modeIndicator) {
        modeIndicator.textContent = mode.charAt(0).toUpperCase() + mode.slice(1) + ' Mode';
        modeIndicator.className = `mode-indicator ${mode}`;
      }

      showNotification(`Switched to ${mode} mode`, 'info');
    }

    // ===============================
    // Streaming Message Handler
    // ===============================

    // Track streaming message elements per server session to prevent
    // duplicate bubbles and support multi-tab streaming.
    const streamingMessages = new Map();

    function handleStreamDelta(data) {
      const { delta, sessionId } = data;

      // Do NOT remove typing indicator here - it must stay visible until the stream
      // is fully complete so the user always knows the agent is still working.

      let streamEl = streamingMessages.get(sessionId);
      const container = document.getElementById('chatMessagesContainer');

      // If we have a tracked stream element but it's detached from the DOM,
      // re-attach it so the user can see it (only for the active session)
      if (streamEl && !streamEl.parentNode && container && sessionId === activeChatSessionId) {
        container.appendChild(streamEl);
      }

      if (!streamEl) {
        if (container) {
          // Check if there's already a streaming bubble in the DOM for this session
          // (e.g. handleStreamComplete was called prematurely but more deltas arrived)
          const existingStream = container.querySelector('.chat-message.streaming');
          if (existingStream && existingStream.dataset.sessionId === sessionId) {
            streamEl = existingStream;
            streamingMessages.set(sessionId, streamEl);
          } else {
            // Create fresh streaming bubble and insert it BEFORE the typing indicator
            // so the user sees both the typing indicator AND the stream content
            const div = document.createElement('div');
            div.className = 'chat-message assistant streaming';
            div.innerHTML = `
              <div class="message-avatar-header" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px;font-weight:600;opacity:0.8;color:var(--accent-secondary,#a78bfa)">
                <span>🤖</span><span>AI Assistant</span>
              </div>
              <div class="message-content"></div>
            `;
            div.dataset.timestamp = Date.now();
            div.dataset.sessionId = sessionId;
            // Only append to container if this is the currently active session
            // (prevents stream bubbles from appearing in wrong tab after a switch)
            if (sessionId === activeChatSessionId) {
              const indicator = document.getElementById('typing-indicator');
              if (indicator && indicator.parentNode === container) {
                container.insertBefore(div, indicator);
              } else {
                container.appendChild(div);
              }
            }
            streamEl = div;
            streamingMessages.set(sessionId, streamEl);
          }
        }
      }

      // Append delta (element may be detached if user switched tabs)
      let content = streamEl?.querySelector('.message-content');
      if (!content && streamEl) {
        // Guard: if the content div is missing for some reason, recreate it
        content = document.createElement('div');
        content.className = 'message-content';
        streamEl.appendChild(content);
      }
      if (content) {
        content.dataset.rawText = (content.dataset.rawText || '') + delta;
        content.innerHTML = formatMarkdown(content.dataset.rawText);
        // Only scroll if element is actually in the DOM
        if (streamEl.parentNode) {
          scrollToBottom();
        }
      }
      console.log('[stream] delta for', sessionId, ':', delta.substring(0, 20));
    }

    function handleStreamComplete(data) {
      const { sessionId } = data;

      removeTypingIndicator(sessionId);

      const streamEl = streamingMessages.get(sessionId);
      if (!streamEl) {
        // Already completed (e.g. message_end handled it, agent_end is redundant)
        // Still ensure input is re-enabled even if stream element was already removed
        updateChatStatus('online');
        enableChatInput(true);
        return;
      }

      decrementAgentWork();

      // Extract final text and add to session history so it survives tab switches
      const contentEl = streamEl.querySelector('.message-content');
      const finalText = contentEl ? (contentEl.dataset.rawText || contentEl.textContent || '') : '';

      const sessions = Array.from(chatSessions.values());
      const targetSession = sessions.find(s => s.serverSessionId === sessionId || s.id === sessionId);
      if (targetSession && finalText) {
        if (!Array.isArray(targetSession.messages)) targetSession.messages = [];
        // Only add if the last message isn't already this assistant message
        const lastMsg = targetSession.messages[targetSession.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.content !== finalText) {
          targetSession.messages.push({
            role: 'assistant',
            content: finalText,
            timestamp: Date.now()
          });
        }
      }

      // Remove empty stream elements from DOM to avoid blank bubbles
      if (!finalText || finalText.trim().length === 0) {
        if (streamEl.parentNode) {
          streamEl.parentNode.removeChild(streamEl);
        }
      } else {
        streamEl.classList.remove('streaming');
        // Add TTS button to the completed assistant message (if not already present)
        if (!streamEl.querySelector('.tts-btn')) {
          const ttsBtn = document.createElement('button');
          ttsBtn.className = 'tts-btn';
          ttsBtn.innerHTML = '🔊';
          ttsBtn.title = 'Speak message';
          ttsBtn.onclick = (e) => {
            e.stopPropagation();
            playTts(finalText, ttsBtn);
          };
          streamEl.appendChild(ttsBtn);
        }
        // Re-attach to DOM if detached and this session is active so user sees the completed message immediately
        if (!streamEl.parentNode && targetSession && targetSession.id === activeChatSessionId) {
          const container = document.getElementById('chatMessagesContainer');
          if (container) {
            container.appendChild(streamEl);
            scrollToBottom();
          }
        }
      }
      streamingMessages.delete(sessionId);

      // Clean up agent activity indicators
      removeAgentActivity(sessionId);

      // Mark this session as recently completed a stream to prevent race condition re-renders
      if (targetSession) {
        targetSession._lastStreamCompleteTime = Date.now();
      }

      console.log('[stream] complete for', sessionId, 'finalText:', finalText.substring(0, 40));
      scrollToBottom();

      // Re-enable input and set status to online so user can continue the conversation
      updateChatStatus('online');
      enableChatInput(true);
    }

    function handleReasoning(data) {
      const { content } = data;

      // Add reasoning in a collapsible section
      const container = document.getElementById('chatMessagesContainer');
      if (container) {
        const div = document.createElement('div');
        div.className = 'chat-message reasoning';
        div.innerHTML = `
          <details class="reasoning-details">
            <summary class="reasoning-summary">💭 Reasoning</summary>
            <div class="reasoning-content">${content}</div>
          </details>
        `;
        container.appendChild(div);
        scrollToBottom();
      }
    }

    function handleReasoningDelta(data) {
      const { content } = data;

      // Find existing reasoning block or create one
      const container = document.getElementById('chatMessagesContainer');
      if (container) {
        let reasoningDiv = container.querySelector('.chat-message.reasoning:last-child');
        if (!reasoningDiv) {
          reasoningDiv = document.createElement('div');
          reasoningDiv.className = 'chat-message reasoning';
          reasoningDiv.innerHTML = `
            <details class="reasoning-details" open>
              <summary class="reasoning-summary">💭 Reasoning</summary>
              <div class="reasoning-content"></div>
            </details>
          `;
          container.appendChild(reasoningDiv);
        }

        const contentDiv = reasoningDiv.querySelector('.reasoning-content');
        if (contentDiv) {
          contentDiv.textContent += content;
        }
        scrollToBottom();
      }
    }

    // ===============================
    // Plan Update Handler
    // ===============================

    function handlePlanUpdate(data) {
      const { plan, action } = data;

      let planContainer = document.getElementById('chatPlanContainer');

      if (!planContainer) {
        // Create plan container
        const container = document.getElementById('chatMessagesContainer');
        if (container) {
          planContainer = document.createElement('div');
          planContainer.id = 'chatPlanContainer';
          planContainer.className = 'chat-plan';
          container.appendChild(planContainer);
        }
      }

      if (planContainer) {
        planContainer.innerHTML = `
          <div class="plan-header">
            <span class="plan-icon">📋</span>
            <span class="plan-title">Plan</span>
            <span class="plan-action">${action || 'Updated'}</span>
          </div>
          <div class="plan-content">${formatPlan(plan)}</div>
        `;
        scrollToBottom();
      }
    }

    function formatPlan(plan) {
      if (typeof plan === 'string') return plan;
      if (Array.isArray(plan)) {
        return `<ul>${plan.map(item => `<li>${item}</li>`).join('')}</ul>`;
      }
      if (typeof plan === 'object') {
        return `<pre>${JSON.stringify(plan, null, 2)}</pre>`;
      }
      return String(plan);
    }

    // ===============================
    // Token Usage Handler
    // ===============================

    function handleTokenUsageUpdate(data) {
      const { sessionId, cumulative } = data;
      if (!cumulative) return;

      // Find the session by serverSessionId
      let session = Array.from(chatSessions.values())
        .find(s => s.serverSessionId === sessionId);

      // Fallback: update the active session if serverSessionId is not yet set or no match
      if (!session && activeChatSessionId) {
        session = chatSessions.get(activeChatSessionId);
      }

      if (session) {
        // Update cumulative token counts in session
        session.totalInputTokens = cumulative.inputTokens || 0;
        session.totalOutputTokens = cumulative.outputTokens || 0;
        session.totalTokens = cumulative.totalTokens || 0;
        session.totalCacheReadTokens = cumulative.cacheReadTokens || 0;
        session.totalCacheWriteTokens = cumulative.cacheWriteTokens || 0;
        session.totalReasoningTokens = cumulative.reasoningTokens || 0;
      }

      // Update UI if this is the active session (match by serverSessionId or fallback)
      const activeSession = activeChatSessionId ? chatSessions.get(activeChatSessionId) : null;
      if (activeSession && (!activeSession.serverSessionId || activeSession.serverSessionId === sessionId)) {
        updateTokenCounterDisplay(cumulative);
      }
    }

    function updateTokenCounterDisplay(cumulative) {
      const tokenIn = document.getElementById('tokenIn');
      const tokenOut = document.getElementById('tokenOut');
      const tokenTotal = document.getElementById('tokenTotal');
      const tokenCounter = document.getElementById('tokenCounter');

      if (tokenIn) tokenIn.textContent = formatTokenCount(cumulative?.inputTokens);
      if (tokenOut) tokenOut.textContent = formatTokenCount(cumulative?.outputTokens);
      if (tokenTotal) tokenTotal.textContent = formatTokenCount(cumulative?.totalTokens);

      if (tokenCounter) {
        tokenCounter.style.display = 'inline-flex';
        // Highlight animation when tokens update
        tokenCounter.classList.add('token-updated');
        setTimeout(() => tokenCounter.classList.remove('token-updated'), 300);
      }
    }

    function formatTokenCount(num) {
      if (num == null || isNaN(num)) return '0';
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
      return num.toString();
    }

    // ===============================
    // Session Resume Handler
    // ===============================

    function handleSessionResumed(data) {
      const { success, sdkSessionId, sessionId, history, message } = data;

      if (success) {
        showNotification('Session resumed successfully', 'success');

        // Update session data
        const session = chatSessions.get(activeChatSessionId);
        if (session) {
          session.serverSessionId = sessionId;
          session.sdkSessionId = sdkSessionId;
          session.initialized = true;

          if (history && history.length > 0) {
            session.messages = history;
            renderChatMessages(session);
          }
        }

        updateChatStatus('online');
        enableChatInput(true);
      } else {
        showNotification(message || 'Failed to resume session', 'error');
      }
    }

    // ===============================
    // Command Functions
    // ===============================

    function sendChatCommand(command) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'chat_command',
          command,
          sessionId: activeChatSessionId
        }));
      } else {
        showNotification('Cannot send command: not connected', 'error');
      }
    }

    function sendInterrupt() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'chat_interrupt',
          sessionId: activeChatSessionId
        }));
      }
      resetAgentWorkingIndicator();
    }

    // ===============================
    // Command Input Handler
    // ===============================

    function processCommandInput(input) {
      // Check if input starts with /
      if (input.startsWith('/')) {
        const parts = input.trim().split(/\s+/);
        const command = parts[0].toLowerCase();

        // Show temporary acknowledgment that command is being processed
        const container = document.getElementById('chatMessagesContainer');
        if (container) {
          const div = document.createElement('div');
          div.className = 'chat-message system pending-command';
          div.dataset.pendingCommand = command;
          div.innerHTML = `<div class="message-content">⏳ Executing ${command}...</div>`;
          container.appendChild(div);
          scrollToBottom();
        }

        // Send as command
        sendChatCommand(command);
        return true;
      }

      return false;
    }

    // Update sendChatMessage to check for commands
    const originalSendChatMessage = sendChatMessage;
    sendChatMessage = function() {
      const input = chatInput?.value?.trim();

      if (input?.startsWith('/')) {
        // Process as command
        processCommandInput(input);
        chatInput.value = '';
        chatInput.style.height = 'auto';
        return;
      }

      // Call original function
      originalSendChatMessage();
    };

    // Re-bind send button to use the overridden function
    if (sendChatBtn) {
      sendChatBtn.removeEventListener('click', originalSendChatMessage);
      sendChatBtn.addEventListener('click', sendChatMessage);
    }

    // Make functions globally available
    window.handlePermissionRequest = handlePermissionRequest;
    window.handleUserInputRequest = handleUserInputRequest;
    window.sendChatCommand = sendChatCommand;
    window.sendInterrupt = sendInterrupt;
    window.showSessionHistoryPanel = showSessionHistoryPanel;
    window.hideSessionHistoryPanel = hideSessionHistoryPanel;
    window.resumeChatSession = resumeChatSession;
    window.loadSessionHistory = loadSessionHistory;

    // ===============================
    // Session History and Resume
    // ===============================

    let sessionHistory = [];
    let sessionHistoryLoaded = false;

    async function loadSessionHistory() {
      try {
        const response = await fetch('/api/chat/sessions?limit=20', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
          const data = await response.json();
          sessionHistory = data.sessions || [];
          sessionHistoryLoaded = true;
          return sessionHistory;
        }
      } catch (err) {
        console.error('Failed to load session history:', err);
      }
      return [];
    }

    async function resumeChatSession(sessionId) {
      try {
        showNotification('Connecting...', 'info');
        updateChatStatus('connecting');

        const response = await fetch(`/api/chat/sessions/${sessionId}/resume`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });

        if (response.ok) {
          const data = await response.json();

          // Find or create client session
          let clientSessionId = null;
          for (const [cid, session] of chatSessions) {
            if (session.serverSessionId === sessionId) {
              clientSessionId = cid;
              break;
            }
          }

          if (!clientSessionId) {
            clientSessionId = `chat_${sessionId}`;
            chatSessions.set(clientSessionId, {
              id: clientSessionId,
              name: 'Resumed Session',
              model: data.model || (availableModels.length > 0 ? availableModels[0].id : 'default'),
              messages: [],
              initialized: false,
              serverSessionId: sessionId,
              sdkSessionId: data.sdkSessionId
            });
          }

          const session = chatSessions.get(clientSessionId);
          session.messages = data.history || [];
          session.sdkSessionId = data.sdkSessionId;
          session.initialized = true;

          selectChatSession(clientSessionId);
          hideChatError();
          updateChatStatus('online');

          showNotification('Session resumed successfully', 'success');
          return true;
        } else {
          const error = await response.json();
          showChatError(error.message || 'Failed to resume session');
          updateChatStatus('offline');
          return false;
        }
      } catch (err) {
        console.error('Resume session error:', err);
        showChatError('Failed to resume session: ' + err.message);
        updateChatStatus('offline');
        return false;
      }
    }

    function showSessionHistoryPanel() {
      // Create or show session history panel
      let panel = document.getElementById('sessionHistoryPanel');

      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'sessionHistoryPanel';
        panel.className = 'session-history-panel';
        panel.innerHTML = `
          <div class="session-history-header-bar">
            <h4>📜 Chat History</h4>
            <button class="session-history-close" onclick="hideSessionHistoryPanel()">×</button>
          </div>
          <div class="session-history-list" id="sessionHistoryList">
            <div class="session-history-empty">Loading...</div>
          </div>
        `;

        // Insert after chat tabs
        const chatTabs = document.getElementById('chatTabs');
        chatTabs.parentNode.insertBefore(panel, chatTabs.nextSibling);
      }

      panel.style.display = 'block';
      loadAndRenderSessionHistory();
    }

    async function loadAndRenderSessionHistory() {
      const list = document.getElementById('sessionHistoryList');
      if (!list) return;

      list.innerHTML = '<div class="session-history-empty">Loading...</div>';

      const sessions = await loadSessionHistory();

      if (sessions.length === 0) {
        list.innerHTML = '<div class="session-history-empty">No previous sessions</div>';
        return;
      }

      list.innerHTML = sessions.map(session => `
        <div class="session-history-item ${session.isActive ? 'active' : ''}" data-session-id="${session.serverSessionId}">
          <div class="session-history-header">
            <span class="session-history-name">${escapeHtml(session.name || 'Untitled')}</span>
            <span class="session-history-date">${formatRelativeTime(session.lastActivity)}</span>
          </div>
          ${session.summary ? `<div class="session-history-preview">${escapeHtml(session.summary)}</div>` : ''}
          <div class="session-history-meta">
            <span>💬 ${session.messageCount || 0} messages</span>
            <span>${session.model || 'default'}</span>
          </div>
          <div class="session-history-actions">
            <button class="btn btn-primary btn-small resume-session-btn" data-session-id="${session.serverSessionId}">
              📂 Resume
            </button>
            <button class="btn btn-secondary btn-small view-session-btn" data-session-id="${session.serverSessionId}">
              👁️ View
            </button>
          </div>
        </div>
      `).join('');

      // Add click handlers
      list.querySelectorAll('.resume-session-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sessionId = btn.dataset.sessionId;
          resumeChatSession(sessionId);
          hideSessionHistoryPanel();
        });
      });

      list.querySelectorAll('.view-session-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sessionId = btn.dataset.sessionId;
          viewSessionMessages(sessionId);
        });
      });
    }

    function hideSessionHistoryPanel() {
      const panel = document.getElementById('sessionHistoryPanel');
      if (panel) {
        panel.style.display = 'none';
      }
    }

    async function viewSessionMessages(sessionId) {
      try {
        const response = await fetch(`/api/chat/sessions/${sessionId}`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
          const data = await response.json();

          // Show messages in a modal or dedicated view
          const messages = data.session?.messages || [];
          const container = document.getElementById('chatMessagesContainer');

          if (container && messages.length > 0) {
            container.innerHTML = '';
            messages.forEach(msg => {
              appendMessageToContainer(msg.content, msg.role);
            });
            scrollToBottom();
          }

          showNotification(`Loaded ${messages.length} messages`, 'info');
        }
      } catch (err) {
        console.error('Failed to view session:', err);
        showNotification('Failed to load session', 'error');
      }
    }

    function formatRelativeTime(timestamp) {
      if (!timestamp) return 'Unknown';

      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;

      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return 'Just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;

      return date.toLocaleDateString();
    }

    // ===============================
    // Command Hints Handling
    // ===============================

    const chatCommandHints = document.getElementById('chatCommandHints');

    // Show command hints when typing "/"
    chatInput?.addEventListener('input', (e) => {
      const value = e.target.value;
      if (value.startsWith('/')) {
        chatCommandHints.style.display = 'flex';
      } else {
        chatCommandHints.style.display = 'none';
      }
    });

    // Handle click on command hints
    chatCommandHints?.addEventListener('click', (e) => {
      const hint = e.target.closest('.hint-item');
      if (hint) {
        const cmd = hint.dataset.cmd;
        chatInput.value = cmd;
        chatCommandHints.style.display = 'none';
        chatInput.focus();
        // Auto-send the command
        sendChatMessage();
      }
    });

    // Handle click on command hint buttons in more menu (mobile)
    document.querySelectorAll('.command-hint-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (chatInput) {
          chatInput.value = cmd;
          chatInput.focus();
        }
        // Close the more menu
        const moreGroup = document.getElementById('chatMoreGroup');
        if (moreGroup) {
          moreGroup.classList.remove('show');
        }
        // Auto-send the command
        sendChatMessage();
      });
    });

    // Make notification function globally available
    window.showNotification = showNotification;
    window.showConfirmationModal = showConfirmationModal;

    // Initialize
    // Hide sidebar toggle initially until user logs in
    if (sidebarToggle) sidebarToggle.style.display = 'none';
    
    // Show auth screen initially (will be hidden if auto-login succeeds)
    if (!authToken) {
      authScreen.classList.add('show');
    }
    
    connect();
