/**
 * SQLite Database Module for Terminal Web UI
 * Handles user authentication and session management
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database path
export const DB_PATH = process.env.DB_PATH || join(__dirname, 'terminal.db');
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@mail.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Initialize database
let db = null;

/**
 * Initialize the database connection and create tables
 */
export function initDatabase() {
  db = new Database(DB_PATH);
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Create tables
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT
    );
    
    -- Sessions table for WebSocket auth
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    
    -- Saved commands table
    CREATE TABLE IF NOT EXISTS saved_commands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      command_text TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    
    -- Chat sessions table
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_name TEXT DEFAULT 'Chat Session',
      model TEXT,
      provider TEXT,
      agent_engine TEXT DEFAULT 'copilot-sdk',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    
    -- Chat messages table
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL, -- 'user', 'assistant', 'system'
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    
    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_saved_commands_user ON saved_commands(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_active ON chat_sessions(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(session_id, timestamp);
  `);
  
  // Add new columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN sdk_session_id TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN summary TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN working_directory TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN agent_engine TEXT DEFAULT 'copilot-sdk'`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN prompt_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN completion_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN total_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  try {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN pi_session_file TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Create index for sdk_session_id lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_sdk ON chat_sessions(sdk_session_id)`);
  
  // Create default admin user if not exists
  createDefaultAdmin();
  
  console.log('✅ Database initialized:', DB_PATH);
  return db;
}

/**
 * Create default admin user
 */
function createDefaultAdmin() {
  const adminEmail = ADMIN_EMAIL;
  const adminPassword = ADMIN_PASSWORD;
  
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  
  if (!existingAdmin) {
    try {
      const hashedPassword = bcrypt.hashSync(adminPassword, 10);
      const userId = randomUUID();
      
      db.prepare(`
        INSERT INTO users (id, email, password_hash, role)
        VALUES (?, ?, ?, 'admin')
      `).run(userId, adminEmail, hashedPassword);
      
      console.log(`✅ Default admin user created: ${adminEmail}`);
      console.log(`   Password: ${adminPassword}`);
    } catch (err) {
      console.error('❌ Failed to create default admin user:', err.message);
    }
  } else {
    console.log(`✅ Default admin exists: ${adminEmail}`);
  }
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    console.log('Database connection closed');
  }
}

// ==========================================
// USER OPERATIONS
// ==========================================

/**
 * Authenticate user
 */
export function authenticateUser(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  
  if (!user) {
    return { success: false, message: 'Invalid email or password' };
  }
  
  const isValid = bcrypt.compareSync(password, user.password_hash);
  
  if (!isValid) {
    return { success: false, message: 'Invalid email or password' };
  }
  
  // Update last login
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  
  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  };
}

/**
 * Reset user password (admin only - no old password required)
 */
export function resetPassword(userId, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  if (!user) {
    return { success: false, message: 'User not found' };
  }
  
  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashedPassword, userId);
  
  return { success: true, message: 'Password reset successfully' };
}

/**
 * Get user by ID
 */
export function getUserById(userId) {
  return db.prepare('SELECT id, email, role, created_at, last_login FROM users WHERE id = ?').get(userId);
}

/**
 * Get user by email
 */
export function getUserByEmail(email) {
  return db.prepare('SELECT id, email, role, created_at, last_login FROM users WHERE email = ?').get(email);
}

/**
 * Get all users (admin only)
 */
export function getAllUsers() {
  return db.prepare('SELECT id, email, role, created_at, last_login FROM users').all();
}

/**
 * Create new user (admin only)
 */
export function createUser(email, password, role = 'user') {
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const userId = randomUUID();
    
    db.prepare(`
      INSERT INTO users (id, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(userId, email, hashedPassword, role);
    
    return { success: true, userId };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, message: 'Email already exists' };
    }
    throw err;
  }
}

/**
 * Delete user (admin only)
 */
export function deleteUser(userId) {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return { success: result.changes > 0 };
}

/**
 * Update user email
 */
export function updateUserEmail(userId, newEmail) {
  try {
    // Check if email already exists (for another user)
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, userId);
    if (existing) {
      return { success: false, message: 'Email already in use by another account' };
    }
    
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(newEmail, userId);
    return { success: true, message: 'Email updated successfully' };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, message: 'Email already exists' };
    }
    throw err;
  }
}

// ==========================================
// SESSION TOKEN OPERATIONS
// ==========================================

/**
 * Generate a session token for persistent authentication
 */
export function generateSessionToken(userId) {
  const token = randomUUID();
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  db.prepare(`
    INSERT INTO user_sessions (id, user_id, token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenId, userId, token, expiresAt.toISOString());
  
  return { token, expiresAt };
}

/**
 * Validate a session token
 */
export function validateSessionToken(token) {
  if (!token) return null;
  
  const result = db.prepare(`
    SELECT t.*, u.email, u.role 
    FROM user_sessions t
    JOIN users u ON t.user_id = u.id
    WHERE t.token = ? AND t.expires_at > ?
  `).get(token, new Date().toISOString());
  
  if (!result) return null;
  
  return {
    valid: true,
    user: {
      id: result.user_id,
      email: result.email,
      role: result.role
    }
  };
}

/**
 * Delete a session token (logout)
 */
export function deleteSessionToken(token) {
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
  return { success: true };
}

/**
 * Clean up expired tokens
 */
export function cleanupExpiredTokens() {
  const result = db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  return { deleted: result.changes };
}

// Export database instance for direct access if needed
export function getDb() {
  return db;
}

// ==========================================
// SAVED COMMANDS OPERATIONS
// ==========================================

/**
 * Get all saved commands for a user
 */
export function getSavedCommands(userId) {
  return db.prepare(`
    SELECT id, name, command_text, created_at 
    FROM saved_commands 
    WHERE user_id = ? 
    ORDER BY created_at DESC
  `).all(userId);
}

/**
 * Create a new saved command
 */
export function createSavedCommand(userId, name, commandText) {
  try {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO saved_commands (id, user_id, name, command_text)
      VALUES (?, ?, ?, ?)
    `).run(id, userId, name, commandText);
    return { success: true, id };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Update a saved command
 */
export function updateSavedCommand(commandId, userId, name, commandText) {
  const result = db.prepare(`
    UPDATE saved_commands 
    SET name = ?, command_text = ?
    WHERE id = ? AND user_id = ?
  `).run(name, commandText, commandId, userId);
  
  if (result.changes === 0) {
    return { success: false, message: 'Command not found or not authorized' };
  }
  return { success: true };
}

/**
 * Delete a saved command
 */
export function deleteSavedCommand(commandId, userId) {
  const result = db.prepare(`
    DELETE FROM saved_commands 
    WHERE id = ? AND user_id = ?
  `).run(commandId, userId);
  
  if (result.changes === 0) {
    return { success: false, message: 'Command not found or not authorized' };
  }
  return { success: true };
}

// ==========================================
// CHAT SESSION OPERATIONS
// ==========================================

/**
 * Create a new chat session
 */
export function createChatSession(userId, sessionName = 'Chat Session', model = null, provider = null, sdkSessionId = null, workingDirectory = null, agentEngine = 'copilot-sdk') {
  try {
    const sessionId = randomUUID();
    db.prepare(`
      INSERT INTO chat_sessions (id, user_id, session_name, model, provider, agent_engine, sdk_session_id, working_directory, created_at, last_activity, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
    `).run(sessionId, userId, sessionName, model, provider, agentEngine, sdkSessionId, workingDirectory);
    
    return { success: true, sessionId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Update SDK session ID for a chat session
 */
export function updateChatSessionSdkId(sessionId, sdkSessionId) {
  const result = db.prepare(`
    UPDATE chat_sessions
    SET sdk_session_id = ?, last_activity = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sdkSessionId, sessionId);
  
  return { success: result.changes > 0 };
}

/**
 * Get chat session by SDK session ID
 */
export function getChatSessionBySdkId(userId, sdkSessionId) {
  return db.prepare(`
    SELECT id, session_name, model, provider, agent_engine, sdk_session_id, working_directory, created_at, last_activity
    FROM chat_sessions
    WHERE user_id = ? AND sdk_session_id = ?
  `).get(userId, sdkSessionId);
}

/**
 * Get chat session by ID
 */
export function getChatSessionById(sessionId, userId) {
  return db.prepare(`
    SELECT id, session_name, model, provider, agent_engine, sdk_session_id, pi_session_file, working_directory, created_at, last_activity, is_active
    FROM chat_sessions
    WHERE id = ? AND user_id = ?
  `).get(sessionId, userId);
}

/**
 * Update chat session summary
 */
export function updateChatSessionSummary(sessionId, summary) {
  const result = db.prepare(`
    UPDATE chat_sessions
    SET summary = ?, last_activity = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(summary, sessionId);
  
  return { success: result.changes > 0 };
}

/**
 * Get active chat session for a user
 */
export function getActiveChatSession(userId) {
  return db.prepare(`
    SELECT id, session_name, model, provider, agent_engine, sdk_session_id, pi_session_file, working_directory, summary, created_at, last_activity
    FROM chat_sessions
    WHERE user_id = ? AND is_active = 1
    ORDER BY last_activity DESC
    LIMIT 1
  `).get(userId);
}

/**
 * Get all chat sessions for a user
 */
export function getChatSessions(userId, limit = null) {
  const sql = `
    SELECT 
      s.id, 
      s.session_name, 
      s.model, 
      s.provider, 
      s.agent_engine,
      s.sdk_session_id,
      s.pi_session_file,
      s.working_directory,
      s.summary,
      s.created_at, 
      s.last_activity,
      s.is_active,
      (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
    FROM chat_sessions s
    WHERE s.user_id = ?
    ORDER BY s.last_activity DESC
    ${limit ? 'LIMIT ?' : ''}
  `;
  const stmt = db.prepare(sql);
  return limit ? stmt.all(userId, limit) : stmt.all(userId);
}

/**
 * Update chat session activity
 */
export function updateChatSessionActivity(sessionId) {
  db.prepare(`
    UPDATE chat_sessions
    SET last_activity = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sessionId);
}

/**
 * Update chat session model
 */
export function updateChatSessionModel(sessionId, model, provider = null) {
  const result = db.prepare(`
    UPDATE chat_sessions
    SET model = ?, provider = ?, last_activity = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(model, provider, sessionId);
  
  return { success: result.changes > 0 };
}

/**
 * Update chat session agent engine
 */
export function updateChatSessionAgentEngine(sessionId, agentEngine) {
  const result = db.prepare(`
    UPDATE chat_sessions
    SET agent_engine = ?, last_activity = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(agentEngine, sessionId);
  
  return { success: result.changes > 0 };
}

/**
 * Update chat session PI session file path
 */
export function updateChatSessionPiFile(sessionId, piSessionFile) {
  const result = db.prepare(`
    UPDATE chat_sessions
    SET pi_session_file = ?, last_activity = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(piSessionFile, sessionId);
  
  return { success: result.changes > 0 };
}

/**
 * Close/deactivate a chat session
 */
export function closeChatSession(sessionId) {
  const result = db.prepare(`
    UPDATE chat_sessions
    SET is_active = 0
    WHERE id = ?
  `).run(sessionId);
  
  return { success: result.changes > 0 };
}

/**
 * Delete a chat session and all its messages
 */
export function deleteChatSession(sessionId, userId) {
  const result = db.prepare(`
    DELETE FROM chat_sessions 
    WHERE id = ? AND user_id = ?
  `).run(sessionId, userId);
  
  return { success: result.changes > 0 };
}

/**
 * Clean up old inactive sessions (keep last 10 per user)
 */
export function cleanupOldChatSessions(daysToKeep = 30) {
  const result = db.prepare(`
    DELETE FROM chat_sessions 
    WHERE is_active = 0 
    AND last_activity < datetime('now', '-${daysToKeep} days')
  `).run();
  
  return { deleted: result.changes };
}

/**
 * Rename a chat session
 */
export function renameChatSession(sessionId, userId, newName) {
  const result = db.prepare(`
    UPDATE chat_sessions
    SET session_name = ?, last_activity = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(newName, sessionId, userId);
  
  return { success: result.changes > 0 };
}

// ==========================================
// CHAT MESSAGE OPERATIONS
// ==========================================

/**
 * Add a message to a chat session
 */
export function addChatMessage(sessionId, role, content, promptTokens = 0, completionTokens = 0, totalTokens = 0) {
  try {
    // Skip empty/undefined content messages to avoid blank bubbles in history
    if (!content || (typeof content === 'string' && content.trim().length === 0)) {
      console.log(`[DB] Skipping empty ${role} message for session ${sessionId}`);
      return { success: false, message: 'Empty content skipped' };
    }
    const messageId = randomUUID();
    db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, timestamp, prompt_tokens, completion_tokens, total_tokens)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `).run(messageId, sessionId, role, content, promptTokens, completionTokens, totalTokens);
    
    // Update session activity
    updateChatSessionActivity(sessionId);
    
    return { success: true, messageId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Get all messages for a chat session
 */
export function getChatMessages(sessionId) {
  return db.prepare(`
    SELECT id, role, content, timestamp, prompt_tokens, completion_tokens, total_tokens
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId);
}

/**
 * Get total token usage for a session
 */
export function getSessionTokenUsage(sessionId) {
  const result = db.prepare(`
    SELECT 
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens
    FROM chat_messages
    WHERE session_id = ?
  `).get(sessionId);
  
  return result;
}

/**
 * Get recent messages for a session (for context restoration)
 */
export function getRecentChatMessages(sessionId, limit = 50) {
  return db.prepare(`
    SELECT id, role, content, timestamp
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(sessionId, limit);
}

/**
 * Clear all messages in a session (but keep the session)
 */
export function clearChatMessages(sessionId) {
  const result = db.prepare(`
    DELETE FROM chat_messages 
    WHERE session_id = ?
  `).run(sessionId);
  
  return { success: true, deleted: result.changes };
}

/**
 * Clean up old chat sessions, keeping only the most recent ones per user
 */
export function cleanupUserChatSessions(userId, keepCount = 20) {
  try {
    // Delete sessions older than 30 days that are inactive
    const oldInactive = db.prepare(`
      DELETE FROM chat_sessions 
      WHERE user_id = ? 
      AND is_active = 0 
      AND last_activity < datetime('now', '-30 days')
    `).run(userId);
    
    // Keep only the most recent sessions per user
    const excess = db.prepare(`
      DELETE FROM chat_sessions 
      WHERE user_id = ? 
      AND id NOT IN (
        SELECT id FROM chat_sessions 
        WHERE user_id = ? 
        ORDER BY last_activity DESC 
        LIMIT ?
      )
    `).run(userId, userId, keepCount);
    
    const totalDeleted = (oldInactive.changes || 0) + (excess.changes || 0);
    
    if (totalDeleted > 0) {
      console.log(`🧹 Cleaned up ${totalDeleted} old chat sessions for user ${userId}`);
    }
    
    return { success: true, deleted: totalDeleted };
  } catch (err) {
    console.error('Error cleaning up chat sessions:', err);
    return { success: false, message: err.message };
  }
}
