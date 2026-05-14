/**
 * Chat Streaming Stability Fix
 * Prevents responses from disappearing mid-stream
 */

// Track active streams globally
const streamingSessions = new Set();

// Prevent render during streaming
function safeRenderChatMessages(session) {
  if (streamingSessions.has(session.id)) {
    console.log('[safeRender] BLOCKED - active stream for', session.id);
    return false;
  }
  
  // Also check the global streamingMessages map from app.js
  if (typeof streamingMessages !== 'undefined' && streamingMessages.has(session.id)) {
    console.log('[safeRender] BLOCKED - streamingMessages has', session.id);
    return false;
  }
  
  // Check if stream completed very recently
  if (session._streamCompletedAt && (Date.now() - session._streamCompletedAt) < 1000) {
    console.log('[safeRender] BLOCKED - stream just completed for', session.id);
    return false;
  }
  
  return true;
}

// Mark stream start
function markStreamStart(sessionId) {
  streamingSessions.add(sessionId);
  console.log('[stream] START', sessionId);
}

// Mark stream end
function markStreamEnd(sessionId) {
  streamingSessions.delete(sessionId);
  const session = chatSessions?.get(sessionId);
  if (session) {
    session._streamCompletedAt = Date.now();
  }
  console.log('[stream] END', sessionId);
}

// Wait for session to be ready
async function waitForSessionReady(sessionId, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const session = chatSessions?.get(sessionId);
    if (session?.initialized && !session?.initializing) {
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// Safe message send with retry
async function safeSendChatMessage(sessionId, message, imagePath, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const session = chatSessions?.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Wait for session to be ready
    if (!session.initialized || session.initializing) {
      console.log(`[safeSend] Waiting for session ${sessionId} to be ready (attempt ${i + 1})`);
      const ready = await waitForSessionReady(sessionId, 5000);
      if (!ready) {
        if (i < maxRetries - 1) continue;
        throw new Error('Session failed to initialize');
      }
    }
    
    // Send the message
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat_send',
        sessionId: sessionId,
        message: message,
        model: session.model,
        imagePath: imagePath
      }));
      return true;
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  throw new Error('Failed to send message after retries');
}

// Export for use in app.js
if (typeof window !== 'undefined') {
  window.chatFix = {
    streamingSessions,
    safeRenderChatMessages,
    markStreamStart,
    markStreamEnd,
    waitForSessionReady,
    safeSendChatMessage
  };
}
