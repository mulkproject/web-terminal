/**
 * PM2 Configuration for Web Terminal
 * 
 * Usage:
 *   pm2 start ecosystem.config.cjs          # Start the server
 *   pm2 stop ecosystem.config.cjs           # Stop the server
 *   pm2 restart ecosystem.config.cjs        # Restart the server
 *   pm2 delete ecosystem.config.cjs         # Remove from PM2
 *   pm2 logs terminal-web-ui                # View logs
 *   pm2 monit                                 # Monitor mode
 */

const fs = require('fs');
const path = require('path');

// Load config from launcher-config.json if it exists
let config = {
  host: 'localhost',
  port: 3456,
  ollama_url: 'http://localhost:11434'
};

const configPath = path.join(__dirname, 'launcher-config.json');
if (fs.existsSync(configPath)) {
  try {
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...savedConfig };
    console.log(`[PM2] Loaded config from launcher-config.json`);
  } catch (e) {
    console.log(`[PM2] Using default config`);
  }
}

module.exports = {
  apps: [{
    name: 'terminal-web-ui',
    script: './server.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: config.port,
      HOST: config.host,
      OLLAMA_HOST: config.ollama_url,
      WORKSPACE_DIR: __dirname
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: config.port,
      HOST: config.host,
      OLLAMA_HOST: config.ollama_url,
      WORKSPACE_DIR: __dirname
    },
    // Log files
    log_file: './logs/pm2-combined.log',
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Restart settings
    min_uptime: '10s',
    max_restarts: 5,
    restart_delay: 3000,
    
    // Kill settings
    kill_timeout: 5000,
    listen_timeout: 8000,
    
    // Monitoring
    monitoring: true,
    pmx: true,
    automation: true,
    
    // Advanced
    merge_logs: true,
    time: true,
    
    // Windows-specific
    windowsHide: true,
    
    // Pre-start check
    exec_mode: 'fork',
    
    // Disable source map support for performance
    source_map_support: false,
    
    // Don't wait for all connections to close before restarting
    wait_ready: false,
    
    // Ready timeout
    ready_timeout: 30000,
    
    // Interpret mode
    interpreter: 'node',
    
    // Args
    args: '',
    
    // Node.js args
    node_args: '--max-old-space-size=1024',
    
    // Force kill
    force: true
  }]
};
