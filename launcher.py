#!/usr/bin/env python3
"""
Web Terminal - Modern Professional GUI Launcher
Sleek, minimalist design with smooth interactions
"""

import tkinter as tk
from tkinter import messagebox, ttk
import subprocess
import threading
import os
import sys
import time
import json
import socket
import ctypes

# Windows power management constants
ES_AWAYMODE_REQUIRED = 0x00000040
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002

# Modern Color Palette - Dark Professional Theme (Monochromatic)
COLORS = {
    # Backgrounds
    'bg_dark': '#0f172a',        # Deep navy
    'bg_card': '#1e293b',        # Slate card
    'bg_input': '#334155',       # Input fields
    'bg_hover': '#475569',       # Hover state
    
    # Buttons - Single Slate Blue Tone
    'btn_primary': '#475569',    # Main buttons
    'btn_secondary': '#334155',  # Secondary buttons  
    'btn_hover': '#64748b',      # Hover state
    'btn_disabled': '#1e293b',   # Disabled state
    
    # Status
    'status_running': '#64748b', # Muted gray for running
    'status_stopped': '#475569', # Muted gray for stopped
    
    # Text
    'text_primary': '#f8fafc',   # White
    'text_secondary': '#94a3b8', # Muted
    'text_muted': '#64748b',     # Dimmer muted
    'text_dark': '#1e293b',      # Dark text for light bg
    
    # Accents
    'yellow': '#eab308',         # Yellow for warnings
    'green': '#22c55e',          # Green for success
    'red': '#ef4444',            # Red for errors
}


class ModernButton(tk.Canvas):
    """Custom modern button with hover effects"""
    def __init__(self, parent, text, command, bg_color=None, fg_color=None, 
                 width=120, height=40, font_size=11, bold=True, **kwargs):
        self.bg_color = bg_color or COLORS['btn_primary']
        self.bg_hover = COLORS['btn_hover'] if bg_color == COLORS['btn_primary'] else COLORS['bg_hover']
        self.fg_color = fg_color or COLORS['text_primary']
        self.command = command
        self.text = text
        
        super().__init__(parent, width=width, height=height, bg=parent['bg'], 
                        highlightthickness=0, cursor='hand2', **kwargs)
        
        self.bind('<Enter>', self.on_enter)
        self.bind('<Leave>', self.on_leave)
        self.bind('<Button-1>', self.on_click)
        
        self.draw()
        
    def draw(self, bg=None):
        self.delete('all')
        bg = bg or self.bg_color
        # Rounded rectangle
        radius = 8
        self.create_rounded_rect(2, 2, 118, 38, radius, fill=bg, outline='')
        # Text
        weight = 'bold' if self.cget('font') else 'normal'
        self.create_text(60, 20, text=self.text, fill=self.fg_color,
                        font=('Segoe UI', 11, 'bold'))
        
    def create_rounded_rect(self, x1, y1, x2, y2, radius, **kwargs):
        points = [
            x1+radius, y1, x2-radius, y1, x2, y1,
            x2, y1+radius, x2, y2-radius, x2, y2,
            x2-radius, y2, x1+radius, y2, x1, y2,
            x1, y2-radius, x1, y1+radius, x1, y1
        ]
        return self.create_polygon(points, smooth=True, **kwargs)
        
    def on_enter(self, event):
        self.draw(self.bg_hover)
        
    def on_leave(self, event):
        self.draw(self.bg_color)
        
    def on_click(self, event):
        self.draw(self.bg_color)
        if self.command:
            self.command()


class ModernCard(tk.Frame):
    """Card component with shadow effect"""
    def __init__(self, parent, title=None, **kwargs):
        super().__init__(parent, bg=COLORS['bg_card'], **kwargs)
        
        # Title
        if title:
            self.header = tk.Frame(self, bg=COLORS['bg_card'])
            self.header.pack(fill=tk.X, padx=20, pady=(15, 0))
            
            tk.Label(self.header, text=title, font=('Segoe UI', 14, 'bold'),
                    bg=COLORS['bg_card'], fg=COLORS['text_primary']).pack(anchor=tk.W)
            
            # Divider
            divider = tk.Frame(self, height=1, bg=COLORS['bg_input'])
            divider.pack(fill=tk.X, padx=20, pady=10)
        
        self.content = tk.Frame(self, bg=COLORS['bg_card'])
        self.content.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)


class SidebarButton(tk.Frame):
    """Sidebar navigation button"""
    def __init__(self, parent, text, icon, command, active=False):
        super().__init__(parent, bg=parent['bg'], height=50)
        self.pack_propagate(False)
        
        self.command = command
        self.active = active
        self.default_bg = COLORS['bg_dark']
        self.active_bg = COLORS['bg_card']
        self.hover_bg = COLORS['bg_card']
        
        self.canvas = tk.Canvas(self, height=50, bg=self.default_bg, 
                               highlightthickness=0, cursor='hand2')
        self.canvas.pack(fill=tk.X)
        
        # Left accent bar
        self.accent_bar = self.canvas.create_rectangle(0, 0, 4, 50, 
                                                       fill=COLORS['btn_primary'] if active else self.default_bg,
                                                       outline='')
        
        # Icon
        self.canvas.create_text(25, 25, text=icon, font=('Segoe UI', 16),
                               fill=COLORS['text_primary'] if active else COLORS['text_secondary'])
        
        # Text
        self.canvas.create_text(55, 25, text=text, font=('Segoe UI', 11),
                               fill=COLORS['text_primary'] if active else COLORS['text_secondary'],
                               anchor=tk.W)
        
        self.canvas.bind('<Enter>', self.on_enter)
        self.canvas.bind('<Leave>', self.on_leave)
        self.canvas.bind('<Button-1>', self.on_click)
        self.canvas.bind('<Button-1>', self.on_click, '+')
        
    def on_enter(self, event):
        if not self.active:
            self.canvas.config(bg=self.hover_bg)
            
    def on_leave(self, event):
        self.canvas.config(bg=self.active_bg if self.active else self.default_bg)
        
    def on_click(self, event):
        self.command()


class WebTerminalLauncher:
    def __init__(self, root):
        self.root = root
        self.root.title("Web Terminal")
        self.root.geometry("1000x700")
        self.root.minsize(900, 600)
        self.root.configure(bg=COLORS['bg_dark'])
        
        # Window icon
        try:
            self.root.iconbitmap('icon.ico')
        except:
            pass
        
        # Server process
        self.server_process = None
        self.server_running = False
        self.installing = False  # Track if installing dependencies
        
        # Pulse animation state
        self._pulse_after_id = None
        self._pulse_on = False
        
        # Get the directory where this script/exe is located
        if getattr(sys, 'frozen', False):
            self.app_dir = os.path.dirname(sys.executable)
        else:
            self.app_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Config
        self.config_file = os.path.join(self.app_dir, 'launcher-config.json')
        self.config = {
            'host': 'localhost', 
            'port': 3456,
            'ollama_url': 'http://localhost:11434',
            'chat_enabled': True
        }
        self.load_config()
        
        # Current page
        self.current_page = 'dashboard'
        
        self.setup_ui()
        self.check_requirements()
        
    def setup_ui(self):
        """Setup the main UI"""
        # Main container
        main_container = tk.Frame(self.root, bg=COLORS['bg_dark'])
        main_container.pack(fill=tk.BOTH, expand=True)
        
        # Sidebar
        self.sidebar = tk.Frame(main_container, bg=COLORS['bg_dark'], width=220)
        self.sidebar.pack(side=tk.LEFT, fill=tk.Y)
        self.sidebar.pack_propagate(False)
        
        # Logo area
        logo_frame = tk.Frame(self.sidebar, bg=COLORS['bg_dark'], height=80)
        logo_frame.pack(fill=tk.X, padx=20, pady=20)
        logo_frame.pack_propagate(False)
        
        tk.Label(logo_frame, text="◆", font=('Segoe UI', 28), 
                bg=COLORS['bg_dark'], fg=COLORS['btn_primary']).pack(anchor=tk.W)
        tk.Label(logo_frame, text="Web Terminal", font=('Segoe UI', 16, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        tk.Label(logo_frame, text="Server Manager", font=('Segoe UI', 10),
                bg=COLORS['bg_dark'], fg=COLORS['text_secondary']).pack(anchor=tk.W)
        
        # Navigation
        nav_frame = tk.Frame(self.sidebar, bg=COLORS['bg_dark'])
        nav_frame.pack(fill=tk.X, pady=20)
        
        self.nav_buttons = {}
        self.nav_buttons['dashboard'] = SidebarButton(nav_frame, "Dashboard", "▶", 
                                                       lambda: self.show_page('dashboard'), True)
        self.nav_buttons['dashboard'].pack(fill=tk.X)
        
        self.nav_buttons['settings'] = SidebarButton(nav_frame, "Settings", "⚙", 
                                                      lambda: self.show_page('settings'))
        self.nav_buttons['settings'].pack(fill=tk.X)
        
        self.nav_buttons['logs'] = SidebarButton(nav_frame, "Logs", "◉", 
                                                  lambda: self.show_page('logs'))
        self.nav_buttons['logs'].pack(fill=tk.X)
        
        self.nav_buttons['dependencies'] = SidebarButton(nav_frame, "Dependencies", "📦", 
                                                           lambda: self.show_page('dependencies'))
        self.nav_buttons['dependencies'].pack(fill=tk.X)
        
        # Status indicator at bottom of sidebar
        status_frame = tk.Frame(self.sidebar, bg=COLORS['bg_dark'])
        status_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=20)
        
        tk.Label(status_frame, text="Server Status", font=('Segoe UI', 9),
                bg=COLORS['bg_dark'], fg=COLORS['text_secondary']).pack(anchor=tk.W)
        
        self.status_indicator_frame = tk.Frame(status_frame, bg=COLORS['bg_dark'])
        self.status_indicator_frame.pack(fill=tk.X, pady=(5, 0))
        
        self.status_dot = tk.Label(self.status_indicator_frame, text="●", 
                                   font=('Segoe UI', 10), bg=COLORS['bg_dark'], fg=COLORS['text_muted'])
        self.status_dot.pack(side=tk.LEFT)
        
        self.status_text = tk.Label(self.status_indicator_frame, text="Stopped", 
                                   font=('Segoe UI', 11, 'bold'),
                                   bg=COLORS['bg_dark'], fg=COLORS['text_secondary'])
        self.status_text.pack(side=tk.LEFT, padx=(5, 0))
        
        # Main content area
        self.content_container = tk.Frame(main_container, bg=COLORS['bg_dark'])
        self.content_container.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=30, pady=30)
        
        # Create pages
        self.pages = {}
        self.setup_dashboard_page()
        self.setup_settings_page()
        self.setup_logs_page()
        self.setup_dependencies_page()
        
        # Show default page
        self.show_page('dashboard')
        
    def setup_dashboard_page(self):
        """Setup the Dashboard page"""
        page = tk.Frame(self.content_container, bg=COLORS['bg_dark'])
        
        # Header
        header = tk.Frame(page, bg=COLORS['bg_dark'])
        header.pack(fill=tk.X, pady=(0, 25))
        
        tk.Label(header, text="Dashboard", font=('Segoe UI', 28, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        tk.Label(header, text="Manage your Web Terminal server", font=('Segoe UI', 12),
                bg=COLORS['bg_dark'], fg=COLORS['text_secondary']).pack(anchor=tk.W, pady=(5, 0))
        
        # Server Control Card
        control_card = ModernCard(page, "Server Control")
        control_card.pack(fill=tk.X, pady=(0, 20))
        
        # Control buttons - Single color tone (Slate Blue)
        btn_frame = tk.Frame(control_card.content, bg=COLORS['bg_card'])
        btn_frame.pack(fill=tk.X, pady=10)
        
        self.start_btn = tk.Button(btn_frame, text="▶  START SERVER", command=self.start_server,
                                  bg=COLORS['btn_primary'], fg=COLORS['text_primary'],
                                  font=('Segoe UI', 12), relief=tk.FLAT,
                                  cursor='hand2', padx=30, pady=12)
        self.start_btn.pack(side=tk.LEFT, padx=(0, 10))
        
        self.stop_btn = tk.Button(btn_frame, text="⏹  STOP SERVER", command=self.stop_server,
                                 bg=COLORS['btn_secondary'], fg=COLORS['text_primary'],
                                 font=('Segoe UI', 12), relief=tk.FLAT,
                                 cursor='hand2', padx=30, pady=12, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT)
        
        # Access URL Card
        url_card = ModernCard(page, "Access URL")
        url_card.pack(fill=tk.X, pady=(0, 20))
        
        url_frame = tk.Frame(url_card.content, bg=COLORS['bg_card'])
        url_frame.pack(fill=tk.X, pady=10)
        
        self.url_label = tk.Label(url_frame, text="http://localhost:3456",
                                 font=('Consolas', 14), bg=COLORS['bg_input'],
                                 fg=COLORS['text_muted'], padx=15, pady=10)
        self.url_label.pack(side=tk.LEFT, fill=tk.Y)
        
        copy_btn = tk.Button(url_frame, text="📋 Copy", command=self.copy_url,
                            bg=COLORS['btn_secondary'], fg=COLORS['text_secondary'],
                            font=('Segoe UI', 10), relief=tk.FLAT, cursor='hand2',
                            activebackground=COLORS['btn_hover'], padx=15)
        copy_btn.pack(side=tk.LEFT, padx=(10, 0))
        
        open_btn = tk.Button(url_frame, text="🌐 Open Browser", command=self.open_browser,
                             bg=COLORS['btn_primary'], fg=COLORS['text_primary'],
                             font=('Segoe UI', 10), relief=tk.FLAT, cursor='hand2',
                             activebackground=COLORS['btn_hover'], padx=15)
        open_btn.pack(side=tk.LEFT, padx=10)
        
        # Port Status Card
        port_card = ModernCard(page, "Port Status")
        port_card.pack(fill=tk.X, pady=(0, 20))
        
        port_frame = tk.Frame(port_card.content, bg=COLORS['bg_card'])
        port_frame.pack(fill=tk.X, pady=10)
        
        # Port number display
        port_info_frame = tk.Frame(port_frame, bg=COLORS['bg_card'])
        port_info_frame.pack(fill=tk.X)
        
        self.port_status_label = tk.Label(port_info_frame, text="Port: 3456",
                                         font=('Consolas', 13), bg=COLORS['bg_card'],
                                         fg=COLORS['text_primary'])
        self.port_status_label.pack(side=tk.LEFT)
        
        self.port_state_label = tk.Label(port_info_frame, text="● Free",
                                         font=('Segoe UI', 11, 'bold'), bg=COLORS['bg_card'],
                                         fg='#22c55e')
        self.port_state_label.pack(side=tk.LEFT, padx=(15, 0))
        
        self.port_process_label = tk.Label(port_info_frame, text="",
                                           font=('Segoe UI', 10), bg=COLORS['bg_card'],
                                           fg=COLORS['text_secondary'])
        self.port_process_label.pack(side=tk.LEFT, padx=(15, 0))
        
        # Buttons row
        port_btn_frame = tk.Frame(port_frame, bg=COLORS['bg_card'])
        port_btn_frame.pack(fill=tk.X, pady=(10, 0))
        
        self.check_port_btn = tk.Button(port_btn_frame, text="🔍 Check Port",
                                         command=self.check_port_status,
                                         bg=COLORS['btn_secondary'], fg=COLORS['text_primary'],
                                         font=('Segoe UI', 10), relief=tk.FLAT, cursor='hand2',
                                         activebackground=COLORS['btn_hover'], padx=15)
        self.check_port_btn.pack(side=tk.LEFT, padx=(0, 10))
        
        self.kill_port_btn = tk.Button(port_btn_frame, text="💀 Kill Process",
                                        command=self.kill_port_process,
                                        bg='#7f1d1d', fg=COLORS['text_primary'],
                                        font=('Segoe UI', 10), relief=tk.FLAT, cursor='hand2',
                                        activebackground='#991b1b', padx=15, state=tk.DISABLED)
        self.kill_port_btn.pack(side=tk.LEFT)
        
        # Quick Info Card
        info_card = ModernCard(page, "Quick Start Guide")
        info_card.pack(fill=tk.X, pady=(0, 20))
        
        info_text = """1. Click "START SERVER" to launch the Web Terminal
2. Wait for the server status to show "Running"
3. Click "Open Browser" or visit the URL shown above
4. Login with default credentials:
      Email: admin@mail.com
      Password: admin123"""
        
        tk.Label(info_card.content, text=info_text, font=('Segoe UI', 11),
                bg=COLORS['bg_card'], fg=COLORS['text_secondary'],
                justify=tk.LEFT, wraplength=700).pack(anchor=tk.W, pady=10)
        
        self.pages['dashboard'] = page
        
    def setup_settings_page(self):
        """Setup the Settings page"""
        page = tk.Frame(self.content_container, bg=COLORS['bg_dark'])
        
        # Header (outside scroll area)
        header = tk.Frame(page, bg=COLORS['bg_dark'])
        header.pack(fill=tk.X, pady=(0, 15))
        
        tk.Label(header, text="Settings", font=('Segoe UI', 28, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        tk.Label(header, text="Configure server and chat settings", font=('Segoe UI', 12),
                bg=COLORS['bg_dark'], fg=COLORS['text_secondary']).pack(anchor=tk.W, pady=(5, 0))
        
        # Create scrollable canvas for content
        canvas = tk.Canvas(page, bg=COLORS['bg_dark'], highlightthickness=0)
        scrollbar = ttk.Scrollbar(page, orient="vertical", command=canvas.yview)
        scrollable_frame = tk.Frame(canvas, bg=COLORS['bg_dark'])
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw", width=780)
        canvas.configure(yscrollcommand=scrollbar.set)
        
        # Enable mousewheel scrolling
        def on_mousewheel(event):
            canvas.yview_scroll(int(-1*(event.delta/120)), "units")
        canvas.bind_all("<MouseWheel>", on_mousewheel)
        
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Network Settings Card
        network_card = ModernCard(scrollable_frame, "Network Configuration")
        network_card.pack(fill=tk.X, pady=(0, 20))
        
        # Host setting
        host_frame = tk.Frame(network_card.content, bg=COLORS['bg_card'])
        host_frame.pack(fill=tk.X, pady=15)
        
        tk.Label(host_frame, text="Host Address", font=('Segoe UI', 12, 'bold'),
                bg=COLORS['bg_card'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        tk.Label(host_frame, text="IP address to bind the server to",
                font=('Segoe UI', 10), bg=COLORS['bg_card'], 
                fg=COLORS['text_secondary']).pack(anchor=tk.W, pady=(2, 10))
        
        self.host_entry = tk.Entry(host_frame, font=('Consolas', 12),
                                   bg=COLORS['bg_input'], fg=COLORS['text_primary'],
                                   insertbackground=COLORS['text_primary'],
                                   relief=tk.FLAT, width=30)
        self.host_entry.pack(anchor=tk.W, fill=tk.X, ipady=8)
        self.host_entry.insert(0, self.config['host'])
        
        # Port setting
        port_frame = tk.Frame(network_card.content, bg=COLORS['bg_card'])
        port_frame.pack(fill=tk.X, pady=15)
        
        tk.Label(port_frame, text="Port Number", font=('Segoe UI', 12, 'bold'),
                bg=COLORS['bg_card'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        tk.Label(port_frame, text="Port to listen on (1024-65535)",
                font=('Segoe UI', 10), bg=COLORS['bg_card'],
                fg=COLORS['text_secondary']).pack(anchor=tk.W, pady=(2, 10))
        
        self.port_entry = tk.Entry(port_frame, font=('Consolas', 12),
                                   bg=COLORS['bg_input'], fg=COLORS['text_primary'],
                                   insertbackground=COLORS['text_primary'],
                                   relief=tk.FLAT, width=30)
        self.port_entry.pack(anchor=tk.W, fill=tk.X, ipady=8)
        self.port_entry.insert(0, str(self.config['port']))
        
        # Network Mode Selector
        mode_frame = tk.Frame(network_card.content, bg=COLORS['bg_card'])
        mode_frame.pack(fill=tk.X, pady=15)
        
        tk.Label(mode_frame, text="Access Mode", font=('Segoe UI', 12, 'bold'),
                bg=COLORS['bg_card'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        
        # Radio buttons for mode selection
        self.network_mode = tk.StringVar(value='network' if self.config['host'] in ['0.0.0.0', '::', ''] else 'local')
        
        mode_radio_frame = tk.Frame(mode_frame, bg=COLORS['bg_card'])
        mode_radio_frame.pack(anchor=tk.W, fill=tk.X, pady=(5, 0))
        
        local_radio = tk.Radiobutton(mode_radio_frame, text="🖥️  Local only (localhost)",
                                     variable=self.network_mode, value='local',
                                     bg=COLORS['bg_card'], fg=COLORS['text_primary'],
                                     selectcolor=COLORS['bg_input'],
                                     activebackground=COLORS['bg_card'],
                                     activeforeground=COLORS['text_primary'],
                                     font=('Segoe UI', 10), command=self._on_network_mode_change)
        local_radio.pack(anchor=tk.W, pady=2)
        
        network_radio = tk.Radiobutton(mode_radio_frame, text="🌐 Network (any device on your network)",
                                       variable=self.network_mode, value='network',
                                       bg=COLORS['bg_card'], fg=COLORS['text_primary'],
                                       selectcolor=COLORS['bg_input'],
                                       activebackground=COLORS['bg_card'],
                                       activeforeground=COLORS['text_primary'],
                                       font=('Segoe UI', 10), command=self._on_network_mode_change)
        network_radio.pack(anchor=tk.W, pady=2)
        
        # Warning label for network mode
        self.network_warning = tk.Label(mode_frame,
                                       text="⚠️  Network mode allows other devices to access this server",
                                       font=('Segoe UI', 9),
                                       bg=COLORS['bg_card'], fg=COLORS['text_secondary'],
                                       wraplength=700)
        self.network_warning.pack(anchor=tk.W, pady=(5, 0))
        
        # Initial update of warning visibility
        self._update_network_warning()
        
        # Help text
        help_frame = tk.Frame(network_card.content, bg=COLORS['bg_card'])
        help_frame.pack(fill=tk.X, pady=15)
        
        help_text = """💡 Tips:
• Local only: Accessible only from this computer (most secure)
• Network: Accessible from other devices on your Wi-Fi/LAN
• Server prevents system sleep while running (stays active when PC locked)"""
        
        tk.Label(help_frame, text=help_text, font=('Segoe UI', 10),
                bg=COLORS['bg_card'], fg=COLORS['text_secondary'],
                justify=tk.LEFT, wraplength=700).pack(anchor=tk.W)
        
        # Ollama Settings Card
        ollama_card = ModernCard(scrollable_frame, "Ollama Configuration")
        ollama_card.pack(fill=tk.X, pady=(0, 20))
        
        # Ollama URL setting
        ollama_url_frame = tk.Frame(ollama_card.content, bg=COLORS['bg_card'])
        ollama_url_frame.pack(fill=tk.X, pady=15)
        
        tk.Label(ollama_url_frame, text="Ollama URL", font=('Segoe UI', 12, 'bold'),
                bg=COLORS['bg_card'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        tk.Label(ollama_url_frame, text="URL of your Ollama server (e.g., http://localhost:11434 for local Ollama)",
                font=('Segoe UI', 10), bg=COLORS['bg_card'], 
                fg=COLORS['text_secondary']).pack(anchor=tk.W, pady=(2, 10))
        
        self.ollama_url_entry = tk.Entry(ollama_url_frame, font=('Consolas', 12),
                                   bg=COLORS['bg_input'], fg=COLORS['text_primary'],
                                   insertbackground=COLORS['text_primary'],
                                   relief=tk.FLAT, width=30)
        self.ollama_url_entry.pack(anchor=tk.W, fill=tk.X, ipady=8)
        self.ollama_url_entry.insert(0, self.config.get('ollama_url', 'http://localhost:11434'))
        
        # Test Ollama Connection button
        test_ollama_btn = tk.Button(ollama_card.content, text="🔍 Test Connection", 
                                    command=self.test_ollama_connection,
                                    bg=COLORS['btn_secondary'], fg=COLORS['text_primary'],
                                    font=('Segoe UI', 10), relief=tk.FLAT, cursor='hand2',
                                    activebackground=COLORS['btn_hover'], padx=15, pady=5)
        test_ollama_btn.pack(anchor=tk.W, pady=(10, 0))
        
        # Ollama help text
        ollama_help_frame = tk.Frame(ollama_card.content, bg=COLORS['bg_card'])
        ollama_help_frame.pack(fill=tk.X, pady=15)
        
        ollama_help_text = """💡 Ollama Tips:
  • Install Ollama from https://ollama.com
  • Run 'ollama pull llama3.2' to download models
  • Use custom model names like gpt-oss:120b-cloud
  • Leave API key empty for local Ollama instances"""
        
        tk.Label(ollama_help_frame, text=ollama_help_text, font=('Segoe UI', 10),
                bg=COLORS['bg_card'], fg=COLORS['text_secondary'],
                justify=tk.LEFT, wraplength=700).pack(anchor=tk.W)
        
        # Chat Feature Toggle Card
        chat_card = ModernCard(scrollable_frame, "💬 Chat Feature")
        chat_card.pack(fill=tk.X, pady=(0, 20))
        
        chat_toggle_frame = tk.Frame(chat_card.content, bg=COLORS['bg_card'])
        chat_toggle_frame.pack(fill=tk.X, pady=15)
        
        self.chat_enabled_var = tk.BooleanVar(value=self.config.get('chat_enabled', True))
        chat_toggle_checkbox = tk.Checkbutton(chat_toggle_frame, 
                                               text="Enable chat (requires Copilot SDK / Ollama)",
                                               variable=self.chat_enabled_var,
                                               bg=COLORS['bg_card'], fg=COLORS['text_primary'],
                                               activebackground=COLORS['bg_card'],
                                               activeforeground=COLORS['text_primary'],
                                               selectcolor=COLORS['bg_input'],
                                               font=('Segoe UI', 11))
        chat_toggle_checkbox.pack(anchor=tk.W)
        
        chat_help = tk.Label(chat_card.content, 
                             text="When disabled, users cannot access chat sessions.",
                             font=('Segoe UI', 10), bg=COLORS['bg_card'], 
                             fg=COLORS['text_secondary'])
        chat_help.pack(anchor=tk.W)
        
        # Save button
        save_frame = tk.Frame(scrollable_frame, bg=COLORS['bg_dark'])
        save_frame.pack(fill=tk.X, pady=20)
        
        self.save_btn = tk.Button(save_frame, text="💾  SAVE SETTINGS", command=self.save_settings,
                                 bg=COLORS['btn_primary'], fg=COLORS['text_primary'],
                                 font=('Segoe UI', 12), relief=tk.FLAT,
                                 cursor='hand2', padx=30, pady=12)
        self.save_btn.pack(side=tk.LEFT)
        
        self.pages['settings'] = page
        
    def setup_logs_page(self):
        """Setup the Logs page"""
        page = tk.Frame(self.content_container, bg=COLORS['bg_dark'])
        
        # Header
        header = tk.Frame(page, bg=COLORS['bg_dark'])
        header.pack(fill=tk.X, pady=(0, 25))
        
        tk.Label(header, text="Server Logs", font=('Segoe UI', 28, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        tk.Label(header, text="Real-time server output", font=('Segoe UI', 12),
                bg=COLORS['bg_dark'], fg=COLORS['text_secondary']).pack(anchor=tk.W, pady=(5, 0))
        
        # Log toolbar
        toolbar = tk.Frame(page, bg=COLORS['bg_dark'])
        toolbar.pack(fill=tk.X, pady=(0, 10))
        
        copy_btn = tk.Button(toolbar, text="📋 Copy All", command=self.copy_logs,
                            bg=COLORS['btn_secondary'], fg=COLORS['text_primary'],
                            font=('Segoe UI', 10), relief=tk.FLAT, cursor='hand2',
                            activebackground=COLORS['btn_hover'], padx=15, pady=5)
        copy_btn.pack(side=tk.LEFT)
        
        clear_btn = tk.Button(toolbar, text="🗑️ Clear", command=self.clear_logs,
                             bg=COLORS['btn_secondary'], fg=COLORS['text_primary'],
                             font=('Segoe UI', 10), relief=tk.FLAT, cursor='hand2',
                             activebackground=COLORS['btn_hover'], padx=15, pady=5)
        clear_btn.pack(side=tk.LEFT, padx=(10, 0))
        
        # Log area
        log_container = tk.Frame(page, bg=COLORS['bg_card'])
        log_container.pack(fill=tk.BOTH, expand=True)
        
        self.log_area = tk.Text(log_container, wrap=tk.WORD, font=('Consolas', 11),
                                bg=COLORS['bg_card'], fg=COLORS['text_secondary'],
                                insertbackground=COLORS['text_primary'],
                                relief=tk.FLAT, padx=15, pady=15,
                                selectbackground=COLORS['btn_hover'],
                                selectforeground=COLORS['text_primary'])
        self.log_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        scrollbar = tk.Scrollbar(log_container, command=self.log_area.yview,
                                bg=COLORS['bg_input'], troughcolor=COLORS['bg_card'])
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_area.config(yscrollcommand=scrollbar.set)
        self.log_area.config(state=tk.DISABLED)
        
        self.pages['logs'] = page
        
    def setup_dependencies_page(self):
        """Setup the Dependencies management page - Modern layout with better space usage"""
        page = tk.Frame(self.content_container, bg=COLORS['bg_dark'])
        
        # Header
        header = tk.Frame(page, bg=COLORS['bg_dark'])
        header.pack(fill=tk.X, pady=(0, 15))
        
        tk.Label(header, text="Dependencies", font=('Segoe UI', 28, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(anchor=tk.W)
        
        # Main content - Two column layout
        content_frame = tk.Frame(page, bg=COLORS['bg_dark'])
        content_frame.pack(fill=tk.BOTH, expand=True)
        
        # LEFT COLUMN - Dependencies list (60% width)
        left_frame = tk.Frame(content_frame, bg=COLORS['bg_card'], padx=15, pady=15)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # Dependencies header with inline button
        deps_header = tk.Frame(left_frame, bg=COLORS['bg_card'])
        deps_header.pack(fill=tk.X, pady=(0, 10))
        
        tk.Label(deps_header, text="📦 Required Dependencies", 
                font=('Segoe UI', 14, 'bold'),
                bg=COLORS['bg_card'], fg=COLORS['text_primary']).pack(side=tk.LEFT)
        
        check_btn = tk.Button(deps_header, text="🔍 Check All", 
                             command=self.check_offline_dependencies,
                             bg=COLORS['btn_primary'], fg=COLORS['text_primary'],
                             font=('Segoe UI', 10, 'bold'), relief=tk.FLAT, cursor='hand2',
                             activebackground=COLORS['btn_hover'], padx=15, pady=5)
        check_btn.pack(side=tk.RIGHT)
        
        # Dependencies in a grid layout (2 columns)
        deps_grid = tk.Frame(left_frame, bg=COLORS['bg_card'])
        deps_grid.pack(fill=tk.BOTH, expand=True)
        
        # Configure grid columns
        deps_grid.columnconfigure(0, weight=1)
        deps_grid.columnconfigure(1, weight=1)
        
        self.dep_status_labels = {}
        self.dep_install_buttons = {}  # Store install button references
        
        deps = [
            ('node', 'Node.js', 'Runtime environment', True),  # True = external install
            ('npm', 'npm', 'Package manager', True),
            ('express', 'Express.js', 'Web framework', False),
            ('ws', 'WebSocket', 'Real-time comms', False),
            ('bcryptjs', 'bcryptjs', 'Password hashing', False),
            ('sqlite', 'better-sqlite3', 'SQLite database', False),
            ('pty', 'node-pty', 'Terminal emulation', False),
            ('copilot', 'Copilot SDK', 'GitHub Copilot', False),
            ('dotenv', 'dotenv', 'Environment vars', False),
        ]
        
        for i, (key, name, desc, is_external) in enumerate(deps):
            row = i // 2
            col = i % 2
            
            # Dependency card
            card = tk.Frame(deps_grid, bg=COLORS['bg_dark'], padx=12, pady=10,
                           highlightbackground='#374151', highlightthickness=1)
            card.grid(row=row, column=col, padx=5, pady=5, sticky='nsew')
            
            # Status indicator and name in one row
            top_row = tk.Frame(card, bg=COLORS['bg_dark'])
            top_row.pack(fill=tk.X)
            
            status_label = tk.Label(top_row, text="○", font=('Segoe UI', 16),
                                   bg=COLORS['bg_dark'], fg=COLORS['text_muted'])
            status_label.pack(side=tk.LEFT, padx=(0, 8))
            
            tk.Label(top_row, text=name, font=('Segoe UI', 11, 'bold'),
                    bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(side=tk.LEFT)
            
            # Description and install button row
            bottom_row = tk.Frame(card, bg=COLORS['bg_dark'])
            bottom_row.pack(fill=tk.X, pady=(5, 0))
            
            tk.Label(bottom_row, text=desc, font=('Segoe UI', 9),
                    bg=COLORS['bg_dark'], fg=COLORS['text_secondary']).pack(side=tk.LEFT)
            
            # Install button (initially hidden)
            if is_external:
                btn_text = "⬇️ Download"
                btn_bg = COLORS['btn_secondary']
            else:
                btn_text = "⬇️ Install"
                btn_bg = COLORS['btn_primary']
            
            install_btn = tk.Button(bottom_row, text=btn_text,
                                   command=lambda k=key: self.install_dependency(k),
                                   bg=btn_bg, fg=COLORS['text_primary'],
                                   font=('Segoe UI', 8), relief=tk.FLAT, cursor='hand2',
                                   activebackground=COLORS['btn_hover'], padx=8, pady=2)
            install_btn.pack(side=tk.RIGHT)
            install_btn.pack_forget()  # Initially hidden
            
            self.dep_status_labels[key] = status_label
            self.dep_install_buttons[key] = {'button': install_btn, 'is_external': is_external}
        
        # RIGHT COLUMN - Info and Log (40% width)
        right_frame = tk.Frame(content_frame, bg=COLORS['bg_card'], padx=15, pady=15, width=300)
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH)
        right_frame.pack_propagate(False)
        
        # Info panel
        info_card = tk.Frame(right_frame, bg=COLORS['bg_dark'], padx=12, pady=12,
                            highlightbackground='#374151', highlightthickness=1)
        info_card.pack(fill=tk.X, pady=(0, 10))
        
        tk.Label(info_card, text="ℹ️ About", font=('Segoe UI', 12, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(anchor=tk.W, pady=(0, 8))
        
        info_text = """All dependencies are bundled for offline use. Click "Check All" to verify installation status.

Status:
  ● Green = Installed & ready
  ○ Gray = Not found"""
        
        tk.Label(info_card, text=info_text, font=('Segoe UI', 9),
                bg=COLORS['bg_dark'], fg=COLORS['text_secondary'],
                justify=tk.LEFT, wraplength=260).pack(anchor=tk.W)
        
        # Log panel (fills remaining space)
        log_card = tk.Frame(right_frame, bg=COLORS['bg_dark'], padx=12, pady=12,
                           highlightbackground='#374151', highlightthickness=1)
        log_card.pack(fill=tk.BOTH, expand=True)
        
        tk.Label(log_card, text="📋 Status Log", font=('Segoe UI', 12, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_primary']).pack(anchor=tk.W, pady=(0, 8))
        
        self.dep_log_area = tk.Text(log_card, wrap=tk.WORD, font=('Consolas', 10),
                                    bg=COLORS['bg_card'], fg=COLORS['text_secondary'],
                                    insertbackground=COLORS['text_primary'],
                                    relief=tk.FLAT, padx=8, pady=8,
                                    selectbackground=COLORS['btn_hover'],
                                    selectforeground=COLORS['text_primary'])
        self.dep_log_area.pack(fill=tk.BOTH, expand=True)
        self.dep_log_area.config(state=tk.DISABLED)
        
        self.pages['dependencies'] = page

    def check_offline_dependencies(self):
        """Check offline dependencies status"""
        self.dep_log("🔍 Checking dependencies...")
        
        # Check Node.js
        try:
            result = subprocess.run(["node", "--version"], capture_output=True, 
                                   text=True, shell=True, timeout=5)
            if result.returncode == 0:
                self._set_offline_dep_status('node', True, result.stdout.strip())
                self.dep_log(f"✅ Node.js {result.stdout.strip()}")
            else:
                self._set_offline_dep_status('node', False)
                self.dep_log("❌ Node.js not found")
        except Exception as e:
            self._set_offline_dep_status('node', False)
            self.dep_log("❌ Node.js not found (required)")
        
        # Check npm
        try:
            result = subprocess.run(["npm", "--version"], capture_output=True, 
                                   text=True, shell=True, timeout=5)
            if result.returncode == 0:
                self._set_offline_dep_status('npm', True, f"v{result.stdout.strip()}")
                self.dep_log(f"✅ npm v{result.stdout.strip()}")
            else:
                self._set_offline_dep_status('npm', False)
                self.dep_log("❌ npm not found")
        except Exception as e:
            self._set_offline_dep_status('npm', False)
        
        # Check node_modules packages (pre-installed)
        packages = [
            ('express', 'express'),
            ('ws', 'ws'),
            ('bcryptjs', 'bcryptjs'),
            ('sqlite', 'better-sqlite3'),
            ('pty', 'node-pty'),
            ('copilot', '@github/copilot-sdk'),
            ('dotenv', 'dotenv'),
        ]
        
        all_installed = True
        for key, pkg_name in packages:
            pkg_path = os.path.join(self.app_dir, 'node_modules', pkg_name)
            if os.path.exists(pkg_path):
                self._set_offline_dep_status(key, True)
                self.dep_log(f"✅ {pkg_name} ready")
            else:
                self._set_offline_dep_status(key, False)
                self.dep_log(f"⚠️ {pkg_name} not found")
                all_installed = False
        
        if all_installed:
            self.dep_log("✅ All dependencies ready - offline mode supported!")
        else:
            self.dep_log("⚠️ Some dependencies missing - may need internet for first run")

    def _set_offline_dep_status(self, key, installed, version=''):
        """Update dependency status indicator and install button visibility"""
        if key not in self.dep_status_labels:
            return
        
        label = self.dep_status_labels[key]
        btn_info = self.dep_install_buttons.get(key, None)
        
        if installed:
            label.config(text="●", fg='#10b981')
            if version:
                label.config(text=f"● {version}")
            # Hide install button
            if btn_info:
                btn_info['button'].pack_forget()
        else:
            label.config(text="○", fg='#ef4444')
            # Show install button
            if btn_info:
                btn_info['button'].pack(side=tk.RIGHT)

    def install_dependency(self, key):
        """Install a specific dependency"""
        import webbrowser
        import threading
        
        btn_info = self.dep_install_buttons.get(key, None)
        if not btn_info:
            return
        
        is_external = btn_info['is_external']
        
        if key == 'node':
            self.dep_log("ℹ️ Opening Node.js download page...")
            self.dep_log("   Please download and install Node.js from the website")
            webbrowser.open('https://nodejs.org/')
            
        elif key == 'npm':
            self.dep_log("ℹ️ npm comes bundled with Node.js")
            self.dep_log("   Please install Node.js first (opening download page...)")
            webbrowser.open('https://nodejs.org/')
            
        else:
            # Install npm package
            package_map = {
                'express': 'express',
                'ws': 'ws',
                'bcryptjs': 'bcryptjs',
                'sqlite': 'better-sqlite3',
                'pty': 'node-pty',
                'copilot': '@github/copilot-sdk',
                'dotenv': 'dotenv',
            }
            
            pkg_name = package_map.get(key, key)
            self.dep_log(f"📦 Installing {pkg_name}...")
            
            def do_install():
                try:
                    result = subprocess.run(
                        ["npm", "install", pkg_name, "--save"],
                        capture_output=True, text=True, shell=True,
                        cwd=self.app_dir, timeout=120
                    )
                    
                    if result.returncode == 0:
                        self.dep_log(f"✅ {pkg_name} installed successfully!")
                        self.root.after(0, lambda: self._set_offline_dep_status(key, True))
                    else:
                        error = result.stderr if result.stderr else "Unknown error"
                        self.dep_log(f"❌ Failed to install {pkg_name}: {error}")
                        self.dep_log("   Try running: npm install " + pkg_name)
                except Exception as e:
                    self.dep_log(f"❌ Error installing {pkg_name}: {str(e)}")
            
            # Run installation in background thread
            thread = threading.Thread(target=do_install)
            thread.daemon = True
            thread.start()


    def dep_log(self, message, tag=None):
        """Add message to dependency log area with optional color tag"""
        def update():
            self.dep_log_area.config(state=tk.NORMAL)
            timestamp = time.strftime('%H:%M:%S')
            
            # Insert timestamp
            self.dep_log_area.insert(tk.END, f"[{timestamp}] ", 'timestamp')
            
            # Determine tag from message content if not specified
            if tag is None:
                if any(kw in message.lower() for kw in ['✅', 'success', 'complete', 'installed']):
                    tag = 'success'
                elif any(kw in message.lower() for kw in ['❌', 'error', 'failed', 'fail', 'err:']):
                    tag = 'error'
                elif any(kw in message.lower() for kw in ['⚠️', 'warning', 'warn']):
                    tag = 'warning'
                elif any(kw in message.lower() for kw in ['ℹ️', 'info', 'installing', 'checking']):
                    tag = 'info'
            
            self.dep_log_area.insert(tk.END, f"{message}\n", tag)
            self.dep_log_area.see(tk.END)
            self.dep_log_area.config(state=tk.DISABLED)
        self.root.after(0, update)
        
    def clear_dep_log(self):
        """Clear the dependency log area"""
        self.dep_log_area.config(state=tk.NORMAL)
        self.dep_log_area.delete(1.0, tk.END)
        self.dep_log_area.config(state=tk.DISABLED)
    
    def reinstall_dependencies(self):
        """Clean reinstall - remove node_modules and install fresh"""
        result = messagebox.askyesno("Reinstall Dependencies", 
            "This will DELETE the existing node_modules folder and reinstall all dependencies from scratch.\n\n"
            "This can fix corrupted installations but will take longer.\n\n"
            "Continue?")
        if not result:
            return
        
        self.install_dependencies(clean=True)
        


    def show_page(self, page_name):
        """Switch to a different page"""
        # Hide all pages
        for page in self.pages.values():
            page.pack_forget()
        
        # Show selected page
        self.pages[page_name].pack(fill=tk.BOTH, expand=True)
        self.current_page = page_name
        
        # Update sidebar active state
        for name, btn in self.nav_buttons.items():
            if name == page_name:
                btn.canvas.config(bg=COLORS['bg_card'])
                btn.canvas.itemconfig(btn.accent_bar, fill=COLORS['btn_primary'])
            else:
                btn.canvas.config(bg=COLORS['bg_dark'])
                btn.canvas.itemconfig(btn.accent_bar, fill=COLORS['bg_dark'])
                
    def load_config(self):
        """Load saved configuration"""
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r') as f:
                    saved = json.load(f)
                    self.config.update(saved)
        except Exception as e:
            self.log(f"⚠️ Config load error: {e}")
    
    def test_ollama_connection(self):
        """Test Ollama connection by querying /api/tags"""
        import urllib.request
        import urllib.error
        
        ollama_url = self.ollama_url_entry.get().strip()
        
        if not ollama_url:
            messagebox.showwarning("Warning", "Please enter an Ollama URL first.")
            return
        
        self.log(f"🔍 Testing Ollama connection to {ollama_url}...")
        
        try:
            # Build the health check URL
            base_url = ollama_url.rstrip('/')
            health_url = f"{base_url}/api/tags"
            
            # Create request
            req = urllib.request.Request(health_url, method='GET')
            
            # Make the request with timeout
            response = urllib.request.urlopen(req, timeout=10)
            response_data = json.loads(response.read().decode('utf-8'))
            
            models = response_data.get('models', [])
            model_names = [m.get('name', 'unknown') for m in models]
            
            self.log(f"✅ Ollama connection successful!")
            self.log(f"   Found {len(models)} models: {', '.join(model_names[:5])}")
            if len(models) > 5:
                self.log(f"   ... and {len(models) - 5} more")
            
            # Show success message
            messagebox.showinfo("Success", f"✅ Ollama is reachable!\n\nURL: {base_url}\nModels: {len(models)} available\n\nFirst few models:\n" + "\n".join(model_names[:5]))
            
        except urllib.error.HTTPError as e:
            error_msg = f"HTTP Error {e.code}: {e.reason}"
            self.log(f"❌ Ollama connection failed: {error_msg}")
            messagebox.showerror("Error", f"❌ Ollama returned error:\n\n{error_msg}")
                
        except urllib.error.URLError as e:
            error_msg = str(e.reason)
            self.log(f"❌ Ollama connection failed: {error_msg}")
            
            if "connection refused" in error_msg.lower():
                messagebox.showerror("Error", f"❌ Connection refused!\n\nMake sure Ollama is running at:\n{ollama_url}")
            elif "name or service not known" in error_msg.lower() or "getaddrinfo failed" in error_msg.lower():
                messagebox.showerror("Error", f"❌ Host not found!\n\nCheck that the URL is correct:\n{ollama_url}")
            elif "timeout" in error_msg.lower():
                messagebox.showerror("Error", f"❌ Connection timed out!\n\nOllama server is not responding.")
            else:
                messagebox.showerror("Error", f"❌ Cannot reach Ollama:\n\n{error_msg}")
                
        except Exception as e:
            error_msg = str(e)
            self.log(f"❌ Ollama connection failed: {error_msg}")
            messagebox.showerror("Error", f"❌ Connection test failed:\n\n{error_msg}")
            
    def save_settings(self):
        """Save settings to config file and .env file"""
        try:
            host = self.host_entry.get().strip()
            port = int(self.port_entry.get().strip())
            ollama_url = self.ollama_url_entry.get().strip()
            
            if not host:
                messagebox.showerror("Error", "Host cannot be empty!")
                return
                
            if port < 1024 or port > 65535:
                messagebox.showerror("Error", "Port must be between 1024 and 65535!")
                return
            
            self.config['host'] = host
            self.config['port'] = port
            self.config['ollama_url'] = ollama_url
            self.config['chat_enabled'] = bool(self.chat_enabled_var.get())
            
            # Update port status display
            self.port_status_label.config(text=f"Port: {port}")
            self.check_port_status()
            
            # Save to JSON config
            with open(self.config_file, 'w') as f:
                json.dump(self.config, f, indent=2)
            
            # Save to .env file for server
            env_path = os.path.join(self.app_dir, '.env')
            env_content = f"""# Terminal Web UI Configuration

# Server port (default: 3456)
PORT={port}

# Workspace directory (default: current directory)
# WORKSPACE_DIR=C:\\Users\\master\\projects

# Debug mode
DEBUG=false

# Ollama server URL (for local models)
OLLAMA_HOST={ollama_url}

# Enable/disable chat feature
CHAT_ENABLED={'true' if self.config.get('chat_enabled', True) else 'false'}
"""
            with open(env_path, 'w') as f:
                f.write(env_content)
            
            self.log(f"✅ Settings saved: {host}:{port}")
            self.log(f"✅ Ollama configured: {ollama_url}")
            self.update_url_display()
            messagebox.showinfo("Success", "Settings saved successfully!\n.env file updated.")
            
        except ValueError:
            messagebox.showerror("Error", "Port must be a valid number!")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to save settings: {e}")
            
    def check_requirements(self):
        """Check if Node.js is installed"""
        try:
            result = subprocess.run(["node", "--version"], capture_output=True, 
                                   text=True, shell=True)
            if result.returncode == 0:
                self.log(f"✅ Node.js {result.stdout.strip()} detected")
            else:
                self.log("❌ Node.js not found!")
        except Exception as e:
            self.log(f"⚠️ Error checking Node.js: {e}")
            
    def log(self, message):
        """Add message to log area"""
        def update():
            self.log_area.config(state=tk.NORMAL)
            timestamp = time.strftime('%H:%M:%S')
            self.log_area.insert(tk.END, f"[{timestamp}] {message}\n")
            self.log_area.see(tk.END)
            self.log_area.config(state=tk.DISABLED)
        self.root.after(0, update)
        
    def clear_logs(self):
        """Clear the log area"""
        self.log_area.config(state=tk.NORMAL)
        self.log_area.delete(1.0, tk.END)
        self.log_area.config(state=tk.DISABLED)
        
    def copy_logs(self):
        """Copy logs to clipboard"""
        self.log_area.config(state=tk.NORMAL)
        log_text = self.log_area.get(1.0, tk.END)
        self.log_area.config(state=tk.DISABLED)
        
        if log_text.strip():
            self.root.clipboard_clear()
            self.root.clipboard_append(log_text)
            self.log("✅ Logs copied to clipboard")
            messagebox.showinfo("Copied", "Logs copied to clipboard!")
            
    def get_url(self):
        """Get the access URL"""
        host = self.config['host']
        port = self.config['port']
        display_host = 'localhost' if host == '0.0.0.0' else host
        return f"http://{display_host}:{port}"
        
    def update_url_display(self):
        """Update URL label"""
        self.url_label.config(text=self.get_url())
        
    def copy_url(self):
        """Copy URL to clipboard"""
        self.root.clipboard_clear()
        self.root.clipboard_append(self.get_url())
        self.log("📋 URL copied to clipboard")
        
    def open_browser(self):
        """Open browser to the URL"""
        import webbrowser
        webbrowser.open(self.get_url())
        
    def start_server(self):
        """Start the Node.js server"""
        if self.server_running or self.installing:
            return
            
        try:
            host = self.config['host']
            port = self.config['port']
            
            # Check if port is already in use
            if self._is_port_in_use(port):
                self._handle_port_conflict(port, host)
                return
            
            os.chdir(self.app_dir)
            
            # Check if node_modules exists
            if not os.path.exists("node_modules"):
                self.installing = True
                self.update_ui_state()
                self.log("📦 Dependencies not found. Starting installation...")
                self.log("⏳ This may take 1-3 minutes. Please wait...")
                
                # Run install in background thread to keep UI responsive
                threading.Thread(target=self._install_dependencies, 
                               args=(host, port), daemon=True).start()
                return
            
            # Dependencies exist, start server directly
            self._do_start_server(host, port)
                
        except Exception as e:
            self.log(f"❌ Error: {str(e)}")
            self.installing = False
            self.update_ui_state()
            messagebox.showerror("Error", f"Failed to start server:\n{str(e)}")
            
    def _is_port_in_use(self, port):
        """Check if a port is already in use"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(('127.0.0.1', port))
            sock.close()
            return result == 0  # Port is in use if connect_ex returns 0
        except:
            return False
            
    def _get_process_on_port(self, port):
        """Get process information for a port using netstat"""
        try:
            # Use netstat to find process on Windows
            result = subprocess.run(
                ['netstat', '-ano'],
                capture_output=True,
                text=True,
                shell=True
            )
            
            for line in result.stdout.split('\n'):
                if f':{port}' in line and 'LISTENING' in line:
                    parts = line.strip().split()
                    if parts:
                        # PID is the last column
                        pid = parts[-1]
                        if pid.isdigit():
                            # Get process name from tasklist
                            try:
                                task_result = subprocess.run(
                                    ['tasklist', '/fi', f'pid eq {pid}', '/fo', 'csv', '/nh'],
                                    capture_output=True,
                                    text=True,
                                    shell=True
                                )
                                process_name = task_result.stdout.split(',')[0].strip().strip('"')
                                return {'pid': int(pid), 'name': process_name}
                            except:
                                return {'pid': int(pid), 'name': 'Unknown'}
            
            return None
        except Exception as e:
            self.log(f"⚠️ Could not get process info: {e}")
            return None
            
    def _handle_port_conflict(self, port, host):
        """Handle port conflict by showing dialog to kill process"""
        process_info = self._get_process_on_port(port)
        
        if process_info:
            message = f"Port {port} is already in use by {process_info['name']} (PID: {process_info['pid']})\n\nDo you want to stop this process and start the server?"
        else:
            message = f"Port {port} is already in use.\n\nDo you want to stop the process using this port and start the server?"
        
        self.log(f"⚠️ Port {port} is in use by {process_info['name'] if process_info else 'another process'}")
        
        # Show dialog in main thread
        self.root.after(0, lambda: self._show_port_conflict_dialog(port, host, process_info, message))
        
    def _show_port_conflict_dialog(self, port, host, process_info, message):
        """Show dialog for port conflict"""
        if messagebox.askyesno("Port Conflict", message, icon='warning'):
            # User wants to kill the process
            if self._kill_process_on_port(port, process_info):
                self.log(f"✅ Process using port {port} stopped")
                # Wait a moment for port to be released
                self.root.after(1000, lambda: self._try_start_after_port_free(port, host))
            else:
                self.log(f"❌ Could not stop process. Try running as administrator.")
                messagebox.showerror("Error", f"Could not stop process on port {port}.\n\nTry running as administrator or choose a different port.")
        else:
            self.log(f"⚠️ Server not started. Port {port} is in use.")
            
    def _try_start_after_port_free(self, port, host):
        """Try to start server after killing conflicting process"""
        if not self._is_port_in_use(port):
            self.log(f"✅ Port {port} is now free")
            self._do_start_server(host, port)
        else:
            self.log(f"⚠️ Port {port} is still in use. Please try again.")
            
    def _kill_process_on_port(self, port, process_info):
        """Kill process using a specific port"""
        try:
            if process_info and process_info['pid']:
                # Kill by PID
                result = subprocess.run(
                    ['taskkill', '/F', '/PID', str(process_info['pid'])],
                    capture_output=True,
                    text=True,
                    shell=True
                )
                return result.returncode == 0
            else:
                # Try to find and kill by port (fallback)
                result = subprocess.run(
                    f'FOR /F "tokens=5" %a IN (\'netstat -ano ^| findstr ":{port}" ^| findstr "LISTENING"\') DO taskkill /F /PID %a',
                    capture_output=True,
                    shell=True
                )
                return result.returncode == 0
        except Exception as e:
            self.log(f"⚠️ Error killing process: {e}")
            return False
            
    def check_port_status(self):
        """Check current port status and update UI"""
        port = self.config['port']
        if self._is_port_in_use(port):
            process_info = self._get_process_on_port(port)
            if process_info:
                self.port_state_label.config(text="● In Use", fg='#ef4444')
                self.port_process_label.config(
                    text=f"by {process_info['name']} (PID: {process_info['pid']})"
                )
                self._last_port_process = process_info
                self.kill_port_btn.config(state=tk.NORMAL)
                self.log(f"🔍 Port {port} is in use by {process_info['name']} (PID: {process_info['pid']})")
            else:
                self.port_state_label.config(text="● In Use", fg='#ef4444')
                self.port_process_label.config(text="by unknown process")
                self._last_port_process = None
                self.kill_port_btn.config(state=tk.NORMAL)
                self.log(f"🔍 Port {port} is in use by unknown process")
        else:
            self.port_state_label.config(text="● Free", fg='#22c55e')
            self.port_process_label.config(text="")
            self._last_port_process = None
            self.kill_port_btn.config(state=tk.DISABLED)
            self.log(f"🔍 Port {port} is free")
            
    def kill_port_process(self):
        """Kill the process using the configured port"""
        port = self.config['port']
        process_info = getattr(self, '_last_port_process', None)
        
        if not process_info:
            process_info = self._get_process_on_port(port)
            
        if not process_info:
            messagebox.showwarning("No Process", f"Could not find a process using port {port}")
            return
            
        if messagebox.askyesno("Kill Process", 
                              f"Kill {process_info['name']} (PID: {process_info['pid']}) using port {port}?",
                              icon='warning'):
            if self._kill_process_on_port(port, process_info):
                self.log(f"✅ Killed {process_info['name']} (PID: {process_info['pid']})")
                self.check_port_status()
            else:
                self.log(f"❌ Failed to kill process. Try running as administrator.")
                messagebox.showerror("Error", "Failed to kill process.\n\nTry running as administrator.")
                
    def _install_dependencies(self, host, port):
        """Install dependencies in background thread"""
        try:
            # Run npm install with real-time output
            process = subprocess.Popen(
                ["npm", "install"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                shell=True,
                cwd=self.app_dir
            )
            
            # Read output in real-time
            while process.poll() is None:
                line = process.stdout.readline()
                if line:
                    self.root.after(0, lambda m=line.strip(): self._log_install_progress(m))
            
            # Check result
            if process.returncode == 0:
                self.root.after(0, lambda: self._on_install_complete(host, port, True))
            else:
                self.root.after(0, lambda: self._on_install_complete(host, port, False))
                
        except Exception as e:
            self.root.after(0, lambda: self._on_install_error(str(e)))
            
    def _log_install_progress(self, message):
        """Log npm install progress"""
        # Only log important messages to avoid spam
        if any(keyword in message.lower() for keyword in 
               ['added', 'packages', 'installed', 'complete', 'error', 'failed', 'warn']):
            self.log(f"  📥 {message}")
            
    def _do_start_server(self, host, port):
        """Actually start the server"""
        try:
            # Prevent Windows from entering sleep while server is running
            self._prevent_system_sleep()
            
            # Set environment variables
            env = os.environ.copy()
            env['PORT'] = str(port)
            env['HOST'] = host
            
            # Set Ollama environment variables
            ollama_url = self.config.get('ollama_url', 'http://localhost:11434')
            
            env['OLLAMA_HOST'] = ollama_url
            env['CHAT_ENABLED'] = 'true' if self.config.get('chat_enabled', True) else 'false'
            
            self.log(f"🚀 Starting Web Terminal server...")
            self.log(f"📡 Ollama: {ollama_url}")
            self.log(f"📁 Working directory: {self.app_dir}")
            
            # Warn about network access and firewall
            if host not in ['localhost', '127.0.0.1', '::1']:
                self.log(f"🌐 Network access enabled on {host}:{port}")
                self.log(f"   Make sure Windows Firewall allows port {port}")
            
            # Verify server.js exists
            server_js_path = os.path.join(self.app_dir, 'server.js')
            if not os.path.exists(server_js_path):
                self.log(f"❌ server.js not found at: {server_js_path}")
                messagebox.showerror("Error", f"server.js not found at:\n{server_js_path}")
                return
            
            self.server_process = subprocess.Popen(
                ["node", "server.js"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                cwd=self.app_dir,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            
            # Start thread to read output
            threading.Thread(target=self.read_output, daemon=True).start()
            
            self.server_running = True
            self.update_ui_state()
            self.update_url_display()
            
            self.log(f"⏳ Waiting for server on port {port}...")
            self.log("💡 Tip: Server will stay active even when PC is locked")
                
        except Exception as e:
            self.log(f"❌ Error: {str(e)}")
            messagebox.showerror("Error", f"Failed to start server:\n{str(e)}")
            
    def _prevent_system_sleep(self):
        """Prevent Windows from entering sleep/hibernate while server is running"""
        try:
            # Tell Windows to keep the system running (prevent sleep when locked)
            ctypes.windll.kernel32.SetThreadExecutionState(
                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED
            )
            self.log("🔒 System sleep prevention enabled (server stays active when locked)")
            self.log("   Note: If still unreachable when locked, check:")
            self.log("   - Windows Settings > System > Power > Screen/Timeout")
            self.log("   - Device Manager > Network adapter > Power Management")
        except Exception as e:
            self.log(f"⚠️ Could not enable sleep prevention: {e}")
            
    def _allow_system_sleep(self):
        """Allow Windows to enter sleep again"""
        try:
            # Reset execution state to allow normal sleep behavior
            ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
        except:
            pass
            
    def _on_install_complete(self, host, port, success):
        """Called when npm install completes"""
        self.installing = False
        if success:
            self.log("✅ Dependencies installed successfully!")
            self._do_start_server(host, port)
        else:
            self.log("❌ Failed to install dependencies")
            self.update_ui_state()
            messagebox.showerror("Error", 
                "Failed to install dependencies.\n\n"
                "Please ensure:\n"
                "• Node.js is installed\n"
                "• You have internet connection\n"
                "• Try running as Administrator")
                
    def _on_install_error(self, error):
        """Called when npm install errors"""
        self.installing = False
        self.update_ui_state()
        self.log(f"❌ Installation error: {error}")
        messagebox.showerror("Error", f"Installation failed:\n{error}")

    def read_output(self):
        """Read server output in background with proper encoding"""
        server_started = False
        error_lines = []
        try:
            while self.server_process and self.server_process.poll() is None:
                try:
                    # Read with proper encoding handling
                    raw_line = self.server_process.stdout.readline()
                    if not raw_line:
                        continue
                    
                    # Try UTF-8 first, fallback to latin-1 which accepts any byte
                    try:
                        line = raw_line.decode('utf-8', errors='replace')
                    except:
                        try:
                            line = raw_line.decode('cp1252', errors='replace')
                        except:
                            line = raw_line.decode('latin-1', errors='replace')
                    
                    msg = line.strip()
                    if msg:
                        # Log ALL output for debugging
                        self.root.after(0, lambda m=msg: self.log(f"  {m}"))
                        
                        # Track errors
                        lower_msg = msg.lower()
                        if 'error' in lower_msg or 'failed' in lower_msg or 'cannot' in lower_msg:
                            error_lines.append(msg)
                        
                        # Check for server ready messages
                        if 'started' in lower_msg or 'server' in lower_msg or 'listening' in lower_msg:
                            if not server_started:
                                server_started = True
                                # Verify server is actually reachable
                                self.root.after(0, self._verify_server_ready)
                except Exception as line_err:
                    # Log error reading line but continue
                    pass
        except Exception as err:
            self.root.after(0, lambda e=err: self.log(f"⚠️ Log error: {e}"))
    
    def _verify_server_ready(self):
        """Verify server is actually accepting connections"""
        import urllib.request
        import urllib.error
        
        host = self.config.get('host', 'localhost')
        port = self.config.get('port', 3456)
        
        # Try to connect to health endpoint
        max_attempts = 30
        attempt = 0
        
        def try_connect():
            nonlocal attempt
            try:
                # Use 127.0.0.1 for health check (works with localhost or 0.0.0.0 binding)
                health_url = f"http://127.0.0.1:{port}/api/health"
                req = urllib.request.Request(health_url, method='GET', timeout=2)
                response = urllib.request.urlopen(req)
                if response.status == 200:
                    self.log("🌐 Server ready and accepting connections!")
                    self.log(f"🌐 Access URL: {self.get_url()}")
                    self.root.after(0, self.check_port_status)
                    return
            except:
                pass
            
            attempt += 1
            if attempt < max_attempts:
                # Try again in 500ms
                self.root.after(500, try_connect)
            else:
                self.log("⚠️ Server may not be fully ready yet. If you can't connect, try refreshing.")
        
        try_connect()
        
    def stop_server(self):
        """Stop the Node.js server"""
        if self.server_process:
            self.log("⏹️ Stopping server...")
            try:
                self.server_process.terminate()
                try:
                    self.server_process.wait(timeout=5)
                except:
                    self.server_process.kill()
                    self.server_process.wait()
            except Exception as e:
                self.log(f"⚠️ Error stopping: {e}")
            finally:
                self.server_process = None
                self.server_running = False
                self.update_ui_state()
                # Restore normal sleep behavior
                self._allow_system_sleep()
                self.log("✅ Server stopped")
                
    def update_ui_state(self):
        """Update UI based on server state"""
        self._stop_pulse()
        if self.installing:
            # Installing dependencies state
            self.status_dot.config(fg=COLORS['text_secondary'])
            self.status_text.config(text="Installing...", fg=COLORS['text_secondary'])
            self.start_btn.config(state=tk.DISABLED, bg=COLORS['btn_disabled'], 
                                 text="⏳ INSTALLING...")
            self.stop_btn.config(state=tk.DISABLED, bg=COLORS['btn_disabled'])
            self.save_btn.config(state=tk.DISABLED)
            self.host_entry.config(state=tk.DISABLED, disabledbackground=COLORS['bg_card'])
            self.port_entry.config(state=tk.DISABLED, disabledbackground=COLORS['bg_card'])
        elif self.server_running:
            self.status_dot.config(fg='#22c55e')
            self.status_text.config(text="Running", fg='#22c55e')
            self.start_btn.config(state=tk.DISABLED, bg=COLORS['btn_disabled'],
                                 text="▶  START SERVER")
            self.stop_btn.config(state=tk.NORMAL, bg=COLORS['btn_primary'])
            self.save_btn.config(state=tk.DISABLED)
            self.host_entry.config(state=tk.DISABLED, disabledbackground=COLORS['bg_card'])
            self.port_entry.config(state=tk.DISABLED, disabledbackground=COLORS['bg_card'])
            self._start_pulse()
            self.check_port_status()
        else:
            self.status_dot.config(fg=COLORS['text_muted'])
            self.status_text.config(text="Stopped", fg=COLORS['text_muted'])
            self.start_btn.config(state=tk.NORMAL, bg=COLORS['btn_primary'],
                                 text="▶  START SERVER")
            self.stop_btn.config(state=tk.DISABLED, bg=COLORS['btn_disabled'])
            self.save_btn.config(state=tk.NORMAL)
            self.host_entry.config(state=tk.NORMAL)
            self.port_entry.config(state=tk.NORMAL)
        
    def _start_pulse(self):
        """Start pulsing animation on status dot when server is running"""
        self._pulse_on = True
        self._pulse_step()
        
    def _pulse_step(self):
        """Single pulse animation step - toggles between bright and dim green"""
        if not self._pulse_on or not self.server_running:
            return
        # Toggle between bright green and muted green
        current_fg = self.status_dot.cget('fg')
        bright = '#22c55e'  # bright green
        dim = '#15803d'     # darker green
        new_fg = dim if current_fg == bright else bright
        self.status_dot.config(fg=new_fg)
        self._pulse_after_id = self.root.after(800, self._pulse_step)
        
    def _stop_pulse(self):
        """Stop pulse animation"""
        self._pulse_on = False
        if self._pulse_after_id:
            self.root.after_cancel(self._pulse_after_id)
            self._pulse_after_id = None
        
    def _on_network_mode_change(self):
        """Handle network mode radio button change"""
        mode = self.network_mode.get()
        if mode == 'local':
            self.host_entry.delete(0, tk.END)
            self.host_entry.insert(0, 'localhost')
        else:
            self.host_entry.delete(0, tk.END)
            self.host_entry.insert(0, '0.0.0.0')
        self._update_network_warning()
        
    def _update_network_warning(self):
        """Update network warning visibility"""
        mode = self.network_mode.get()
        if mode == 'network':
            self.network_warning.config(fg=COLORS['yellow'])
        else:
            self.network_warning.config(fg=COLORS['text_secondary'])
        
    def on_closing(self):
        """Handle window close"""
        if self.server_running:
            if messagebox.askyesno("Confirm", "Server is running. Stop and exit?"):
                self.stop_server()
            else:
                return
        self.root.destroy()
        sys.exit(0)


def main():
    root = tk.Tk()
    app = WebTerminalLauncher(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()


if __name__ == "__main__":
    main()
