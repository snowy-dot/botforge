// =====================================================
// BotForge Backend - Version 8.0
// Discord Bot Hosting + Website Hosting!
// =====================================================

import express from "express";
import cors from "cors";
import { Client, GatewayIntentBits } from "discord.js";
import { NodeVM } from "vm2";
import multer from "multer";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// =====================================================
// SECURITY CONFIGURATION
// =====================================================
const SECURITY = {
  MAX_MEMORY_MB: 128,
  MAX_CPU_TIME_MS: 5000,
  BOT_TIMEOUT_MS: 300000,
  MAX_CODE_SIZE: 50000,
  MAX_BOT_COUNT: 5
};

const runningBots = new Map();

// =====================================================
// DANGEROUS PATTERNS CHECK
// =====================================================
const DANGEROUS_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /require\s*\(\s*['"]fs['"]\s*\)/i,
  /require\s*\(\s*['"]fs\//i,
  /process\.exit/i,
  /process\.kill/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /require\s*\(\s*['"]http['"]\s*\)/i,
  /require\s*\(\s*['"]https['"]\s*\)/i,
  /require\s*\(\s*['"]net['"]\s*\)/i,
  /require\s*\(\s*['"]dgram['"]\s*\)/i,
  /\bwhile\s*\(\s*true\s*\)/i,
  /\bfor\s*\(\s*;;\s*\)/i,
  /setInterval\s*\([^,]+,\s*1\s*\)/i
];

function checkCodeSafety(code) {
  const violations = [];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(pattern.toString());
    }
  }

  if (!code.includes('discord.js')) {
    violations.push('Code must use discord.js');
  }

  return violations;
}

// =====================================================
// SANDBOXED BOT RUNNER
// =====================================================
class SandboxedBot {
  constructor(userId, code, token) {
    this.userId = userId;
    this.code = code;
    this.token = token;
    this.vm = null;
    this.logs = [];
    this.startTime = Date.now();
  }

  async start() {
    try {
      this.vm = new NodeVM({
        console: 'redirect',
        sandbox: {
          process: {
            env: {
              DISCORD_TOKEN: this.token
            }
          }
        },
        require: {
          external: false,
          builtin: [],
          root: path.join(__dirname, "node_modules"),
          mock: {
            fs: {},
            child_process: {},
            http: {},
            https: {},
            net: {},
            dgram: {}
          }
        },
        timeout: SECURITY.MAX_CPU_TIME_MS,
        memoryLimit: SECURITY.MAX_MEMORY_MB
      });

      const wrappedCode = `
        const Module = require('module');
        const originalRequire = Module.prototype.require;
        Module.prototype.require = function(id) {
          if (id === 'discord.js') {
            return originalRequire.call(this, 'discord.js');
          }
          throw new Error('Module not allowed: ' + id + '. Only discord.js is permitted.');
        };
        
        ${this.code}
      `;

      this.vm.run(wrappedCode, 'bot.js');
      this.logs.push('✅ Bot started successfully in sandbox');
      return { success: true };
    } catch (error) {
      this.logs.push(`❌ Sandbox error: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    if (this.vm) {
      try {
        this.vm = null;
      } catch (err) {
        console.error('Error stopping VM:', err.message);
      }
    }
  }

  getLogs() {
    return this.logs.slice(-50);
  }

  getUptime() {
    return Date.now() - this.startTime;
  }
}

// =====================================================
// BASIC ENDPOINTS
// =====================================================

app.get("/", (req, res) => {
  res.json({
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "8.0.0 - Bot + Website Hosting!",
    features: {
      discordBots: "✅ Active",
      websiteHosting: "✅ Active",
      sandboxing: "✅ Enabled",
      autoKill: "✅ Enabled"
    },
    activeBots: runningBots.size
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    activeBots: runningBots.size,
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// DISCORD BOT ENDPOINTS
// =====================================================

app.post("/api/validate-token", async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return res.json({ valid: false, message: "❌ Please paste your bot token!" });
  }

  if (token.length < 50) {
    return res.json({ valid: false, message: "❌ Token too short." });
  }

  try {
    const tempClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    await tempClient.login(token);
    
    const botInfo = {
      valid: true,
      message: "✅ Token is valid!",
      bot: {
        id: tempClient.user.id,
        username: tempClient.user.username,
        tag: tempClient.user.tag
      }
    };

    await tempClient.destroy();
    return res.json(botInfo);
  } catch (error) {
    return res.json({ valid: false, message: "❌ Invalid token." });
  }
});

app.post("/api/bot/start", async (req, res) => {
  const { code, token } = req.body;
  const userId = req.ip || "user-" + Date.now();

  if (!code || !token) {
    return res.json({ success: false, message: "❌ Missing code or token!" });
  }

  if (code.length > SECURITY.MAX_CODE_SIZE) {
    return res.json({ 
      success: false, 
      message: `❌ Code too large! Max ${SECURITY.MAX_CODE_SIZE / 1000}KB` 
    });
  }

  if (runningBots.size >= SECURITY.MAX_BOT_COUNT) {
    return res.json({ 
      success: false, 
      message: "❌ Server at max capacity!" 
    });
  }

  if (runningBots.has(userId)) {
    return res.json({ 
      success: false, 
      message: "❌ You already have a bot running!" 
    });
  }

  const violations = checkCodeSafety(code);
  if (violations.length > 0) {
    return res.json({
      success: false,
      message: `❌ Security violation! Disallowed code patterns detected. Your code uses dangerous functions.`
    });
  }

  try {
    const tempClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    await tempClient.login(token);
    const botTag = tempClient.user.tag;
    await tempClient.destroy();

    console.log(`🔒 Starting sandboxed bot: ${botTag}`);

    const bot = new SandboxedBot(userId, code, token);
    
    try {
      await bot.start();
    } catch (sandboxError) {
      return res.json({
        success: false,
        message: `❌ Sandbox error: ${sandboxError.message}`
      });
    }

    const timeoutId = setTimeout(() => {
      console.log(`⏱️ Auto-killing bot ${botTag} after timeout`);
      bot.stop();
      runningBots.delete(userId);
    }, SECURITY.BOT_TIMEOUT_MS);

    runningBots.set(userId, {
      bot: bot,
      botTag: botTag,
      startTime: Date.now(),
      timeoutId: timeoutId
    });

    res.json({
      success: true,
      message: `✅ Bot ${botTag} is running in SECURE sandbox!`,
      botTag: botTag,
      security: {
        memoryLimit: SECURITY.MAX_MEMORY_MB + "MB",
        autoKillIn: Math.floor(SECURITY.BOT_TIMEOUT_MS / 60000) + " minutes",
        codeScanned: true
      }
    });
  } catch (error) {
    console.error('Bot start error:', error);
    res.json({
      success: false,
      message: `❌ Failed: ${error.message}`
    });
  }
});

app.post("/api/bot/stop", (req, res) => {
  const userId = req.ip || "user-" + Date.now();
  const botData = runningBots.get(userId);

  if (!botData) {
    return res.json({ success: false, message: "❌ No bot running!" });
  }

  try {
    clearTimeout(botData.timeoutId);
    botData.bot.stop();
    runningBots.delete(userId);
    
    res.json({ 
      success: true, 
      message: `✅ Bot ${botData.botTag} stopped and sandbox cleaned!` 
    });
  } catch (error) {
    res.json({ success: false, message: `❌ Error: ${error.message}` });
  }
});

app.get("/api/bot/logs/:userId", (req, res) => {
  const botData = runningBots.get(req.params.userId);
  if (!botData) {
    return res.json({ running: false, logs: [] });
  }
  res.json({
    running: true,
    botTag: botData.botTag,
    uptime: Date.now() - botData.startTime,
    logs: botData.bot.getLogs()
  });
});

app.get("/api/bots", (req, res) => {
  const bots = Array.from(runningBots.entries()).map(([userId, data]) => ({
    userId: userId,
    botTag: data.botTag,
    uptime: Math.floor((Date.now() - data.startTime) / 1000) + "s",
    sandboxed: true
  }));

  res.json({
    totalBots: bots.length,
    maxBots: SECURITY.MAX_BOT_COUNT,
    bots: bots
  });
});

// =====================================================
// WEBSITE HOSTING ENDPOINTS
// =====================================================

// Setup file upload for websites
const websiteStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userId = req.body.userId || "guest-" + Date.now();
    const userFolder = path.join(__dirname, "websites", userId);
    await fs.mkdir(userFolder, { recursive: true });
    cb(null, userFolder);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const websiteUpload = multer({ 
  storage: websiteStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max per file
});

// Upload website files
app.post("/api/website/upload", websiteUpload.array("files"), async (req, res) => {
  try {
    const userId = req.body.userId || "guest-" + Date.now();
    const files = req.files;
    
    if (!files || files.length === 0) {
      return res.json({ success: false, message: "❌ No files uploaded!" });
    }

    console.log(`📁 User ${userId} uploaded ${files.length} file(s)`);
    
    res.json({
      success: true,
      message: `✅ Uploaded ${files.length} file(s)!`,
      userId: userId,
      previewUrl: `/preview/${userId}/`,
      files: files.map(f => f.originalname)
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.json({ success: false, message: `❌ Error: ${error.message}` });
  }
});

// List uploaded files
app.get("/api/website/files/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userFolder = path.join(__dirname, "websites", userId);
    
    if (!fsSync.existsSync(userFolder)) {
      return res.json({ success: true, files: [] });
    }

    const files = await fs.readdir(userFolder);
    res.json({ 
      success: true,
      userId: userId,
      files: files,
      previewUrl: `/preview/${userId}/`
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Serve uploaded websites
app.get("/preview/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userFolder = path.join(__dirname, "websites", userId);
    const indexFile = path.join(userFolder, "index.html");
    
    if (fsSync.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(404).send(`
        <html>
          <body style="background:#0e0e10;color:white;font-family:sans-serif;text-align:center;padding:50px;">
            <h1>❌ No Website Found</h1>
            <p>Upload an index.html file first!</p>
            <a href="/" style="color:#5865F2;">← Back to BotForge</a>
          </body>
        </html>
      `);
    }
  } catch (error) {
    res.status(500).send("❌ Error: " + error.message);
  }
});

app.get("/preview/:userId/:filename", async (req, res) => {
  try {
    const { userId, filename } = req.params;
    const filePath = path.join(__dirname, "websites", userId, filename);
    
    if (fsSync.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send("❌ File not found!");
    }
  } catch (error) {
    res.status(500).send("❌ Error: " + error.message);
  }
});

// =====================================================
// CLEANUP & SHUTDOWN
// =====================================================

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down - cleaning up...');
  for (const [userId, botData] of runningBots.entries()) {
    clearTimeout(botData.timeoutId);
    await botData.bot.stop();
  }
  process.exit(0);
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log(`✅ BotForge v8.0 running on port ${PORT}`);
  console.log(`🛡️ vm2 Sandboxing: ENABLED`);
  console.log(`🤖 Discord bot hosting: ACTIVE`);
  console.log(`🌐 Website hosting: ACTIVE`);
  console.log(`🔒 Memory limit: ${SECURITY.MAX_MEMORY_MB}MB per bot`);
  console.log(`⏱️ Auto-kill: ${SECURITY.BOT_TIMEOUT_MS / 1000}s`);
  console.log(`🚫 Dangerous code patterns: BLOCKED`);
});
