// =====================================================
// BotForge Backend - Version 9.0.1 (Bug Fixes)
// Discord Bot Hosting + Website Hosting
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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use((req, res, next) => {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${req.method} ${req.path}`);
  next();
});

const DATA_DIR = path.join(__dirname, "data");
const WEBSITES_DIR = path.join(__dirname, "websites");

async function ensureDirs() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(WEBSITES_DIR, { recursive: true });
  } catch (err) {
    console.error("Error creating directories:", err);
  }
}
ensureDirs();

const SECURITY = {
  MAX_MEMORY_MB: 128,
  MAX_CPU_TIME_MS: 5000,
  BOT_TIMEOUT_MS: 3600000,
  MAX_CODE_SIZE: 50000,
  MAX_BOT_COUNT: 10,
  MAX_FILE_SIZE: 5 * 1024 * 1024,
  MAX_FILES_PER_UPLOAD: 20
};

const runningBots = new Map();
const deploymentLog = [];

function getUserId(req) {
  return req.headers['x-user-id'] || req.ip || "user-" + Date.now();
}

const DANGEROUS_PATTERNS = [
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/i, name: "child_process" },
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/i, name: "fs module" },
  { pattern: /require\s*\(\s*['"]fs\//i, name: "fs submodule" },
  { pattern: /process\.exit/i, name: "process.exit" },
  { pattern: /process\.kill/i, name: "process.kill" },
  { pattern: /eval\s*\(/i, name: "eval()" },
  { pattern: /Function\s*\(/i, name: "Function constructor" },
  { pattern: /\bnew\s+Function\s*\(/i, name: "new Function" },
  { pattern: /require\s*\(\s*['"]http['"]\s*\)/i, name: "http module" },
  { pattern: /require\s*\(\s*['"]https['"]\s*\)/i, name: "https module" },
  { pattern: /require\s*\(\s*['"]net['"]\s*\)/i, name: "net module" },
  { pattern: /require\s*\(\s*['"]dgram['"]\s*\)/i, name: "dgram module" },
  { pattern: /\bwhile\s*\(\s*true\s*\)/i, name: "infinite while loop" },
  { pattern: /\bfor\s*\(\s*;;\s*\)/i, name: "infinite for loop" }
];

function checkCodeSafety(code) {
  const violations = [];
  for (const { pattern, name } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) violations.push(name);
  }
  if (!code.includes('discord.js')) violations.push('discord.js required');
  return violations;
}

// =====================================================
// SANDBOXED BOT RUNNER (FIXED)
// =====================================================
class SandboxedBot {
  constructor(userId, code, token) {
    this.userId = userId;
    this.code = code;
    this.token = token;
    this.vm = null;
    this.logs = [];
    this.startTime = Date.now();
    this.botTag = null;
  }

  async start() {
    try {
      // Load discord.js OUTSIDE the sandbox so we can pass it in
      const discordModule = await import('discord.js');

      this.vm = new NodeVM({
        console: 'redirect',
        sandbox: {
          process: {
            env: { DISCORD_TOKEN: this.token }
          },
          console: {
            log: (...args) => this.addLog('LOG', args.join(' ')),
            error: (...args) => this.addLog('ERROR', args.join(' ')),
            warn: (...args) => this.addLog('WARN', args.join(' ')),
            info: (...args) => this.addLog('INFO', args.join(' '))
          },
          // Pass discord.js directly into the sandbox!
          discord: discordModule
        },
        require: {
          external: false,
          builtin: [],
          root: path.join(__dirname, "node_modules"),
          mock: {}
        },
        timeout: SECURITY.MAX_CPU_TIME_MS,
        memoryLimit: SECURITY.MAX_MEMORY_MB
      });

      // Wrap the code to intercept require calls
      const wrappedCode = `
        // Override require to ONLY allow discord.js
        const _Module = { exports: {} };
        const _discord = discord;
        
        // Intercept require
        const require = function(id) {
          if (id === 'discord.js' || id === 'discord') {
            return _discord;
          }
          throw new Error('Module not allowed: ' + id + '. Only discord.js is permitted.');
        };
        
        // Make module.exports work normally
        const module = { exports: {} };
        const exports = module.exports;
        
        ${this.code}
      `;

      this.vm.run(wrappedCode, 'bot.js');
      this.addLog('SYSTEM', '✅ Bot started successfully in sandbox');
      return { success: true };
    } catch (error) {
      this.addLog('ERROR', `❌ Sandbox error: ${error.message}`);
      throw error;
    }
  }

  addLog(level, message) {
    const time = new Date().toLocaleTimeString();
    this.logs.push({ time, level, message });
    if (this.logs.length > 200) this.logs.shift();
  }

  async stop() {
    if (this.vm) {
      try {
        this.vm = null;
        this.addLog('SYSTEM', '🛑 Bot stopped');
      } catch (err) {
        console.error('Error stopping VM:', err.message);
      }
    }
  }

  getLogs() { return this.logs.slice(-50); }
  getUptime() { return Date.now() - this.startTime; }
}

app.get("/", (req, res) => {
  res.json({
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "9.0.1 - Bug Fixes!",
    features: {
      discordBots: "✅ Active",
      websiteHosting: "✅ Active",
      sandboxing: "✅ Enabled",
      autoKill: "✅ 1 hour timeout",
      deploymentTracking: "✅ Active"
    },
    activeBots: runningBots.size,
    maxBots: SECURITY.MAX_BOT_COUNT
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

app.get("/ping", (req, res) => {
  res.json({ pong: true, timestamp: Date.now() });
});

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
        tag: tempClient.user.tag,
        avatar: tempClient.user.displayAvatarURL()
      }
    };
    await tempClient.destroy();
    return res.json(botInfo);
  } catch (error) {
    return res.json({ valid: false, message: `❌ Invalid token: ${error.message}` });
  }
});

app.post("/api/bot/start", async (req, res) => {
  const { code, token } = req.body;
  const userId = getUserId(req);

  if (!code || !token) {
    return res.json({ success: false, message: "❌ Missing code or token!" });
  }
  if (code.length > SECURITY.MAX_CODE_SIZE) {
    return res.json({ success: false, message: `❌ Code too large! Max ${SECURITY.MAX_CODE_SIZE / 1000}KB` });
  }
  if (runningBots.size >= SECURITY.MAX_BOT_COUNT) {
    return res.json({ success: false, message: `❌ Server at max capacity! (${SECURITY.MAX_BOT_COUNT} bots running)` });
  }
  if (runningBots.has(userId)) {
    return res.json({ success: false, message: "❌ You already have a bot running! Stop it first." });
  }

  const violations = checkCodeSafety(code);
  if (violations.length > 0) {
    return res.json({ success: false, message: `❌ Security violation! Blocked: ${violations.join(', ')}` });
  }

  try {
    const tempClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    await tempClient.login(token);
    const botTag = tempClient.user.tag;
    const botId = tempClient.user.id;
    await tempClient.destroy();

    console.log(`🔒 Starting sandboxed bot: ${botTag}`);

    const bot = new SandboxedBot(userId, code, token);
    try {
      await bot.start();
    } catch (sandboxError) {
      return res.json({ success: false, message: `❌ Sandbox error: ${sandboxError.message}` });
    }

    const timeoutId = setTimeout(() => {
      console.log(`⏱️ Auto-killing bot ${botTag} after 1 hour timeout`);
      bot.stop();
      runningBots.delete(userId);
      deploymentLog.push({ type: 'bot', action: 'auto-killed', userId, botTag, timestamp: new Date().toISOString() });
    }, SECURITY.BOT_TIMEOUT_MS);

    runningBots.set(userId, { bot, botTag, botId, startTime: Date.now(), timeoutId });

    deploymentLog.push({ type: 'bot', action: 'started', userId, botTag, timestamp: new Date().toISOString() });

    res.json({
      success: true,
      message: `✅ Bot ${botTag} is running! Auto-kill in 1 hour.`,
      botTag, botId, userId,
      security: { memoryLimit: SECURITY.MAX_MEMORY_MB + "MB", autoKillIn: "60 minutes", codeScanned: true }
    });
  } catch (error) {
    console.error('Bot start error:', error);
    res.json({ success: false, message: `❌ Failed: ${error.message}` });
  }
});

app.post("/api/bot/stop", (req, res) => {
  const userId = getUserId(req);
  const botData = runningBots.get(userId);
  if (!botData) return res.json({ success: false, message: "❌ No bot running!" });

  try {
    clearTimeout(botData.timeoutId);
    botData.bot.stop();
    runningBots.delete(userId);
    deploymentLog.push({ type: 'bot', action: 'stopped', userId, botTag: botData.botTag, timestamp: new Date().toISOString() });
    res.json({ success: true, message: `✅ Bot ${botData.botTag} stopped!` });
  } catch (error) {
    res.json({ success: false, message: `❌ Error: ${error.message}` });
  }
});

app.get("/api/bot/logs/:userId", (req, res) => {
  const botData = runningBots.get(req.params.userId);
  if (!botData) return res.json({ running: false, logs: [] });
  res.json({ running: true, botTag: botData.botTag, uptime: Date.now() - botData.startTime, logs: botData.bot.getLogs() });
});

app.get("/api/bots", (req, res) => {
  const bots = Array.from(runningBots.entries()).map(([userId, data]) => ({
    userId, botTag: data.botTag, botId: data.botId,
    uptime: Math.floor((Date.now() - data.startTime) / 1000) + "s",
    sandboxed: true
  }));
  res.json({ totalBots: bots.length, maxBots: SECURITY.MAX_BOT_COUNT, bots });
});

const websiteStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userId = req.body.userId || "guest-" + Date.now();
    const userFolder = path.join(WEBSITES_DIR, userId);
    await fs.mkdir(userFolder, { recursive: true });
    cb(null, userFolder);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});

const websiteUpload = multer({
  storage: websiteStorage,
  limits: { fileSize: SECURITY.MAX_FILE_SIZE, files: SECURITY.MAX_FILES_PER_UPLOAD }
});

app.post("/api/website/upload", websiteUpload.array("files"), async (req, res) => {
  try {
    const userId = req.body.userId || "guest-" + Date.now();
    const files = req.files;
    if (!files || files.length === 0) return res.json({ success: false, message: "❌ No files uploaded!" });

    console.log(`📁 User ${userId} uploaded ${files.length} file(s)`);
    deploymentLog.push({ type: 'website', action: 'uploaded', userId, fileCount: files.length, files: files.map(f => f.originalname), timestamp: new Date().toISOString() });

    res.json({
      success: true, message: `✅ Uploaded ${files.length} file(s)!`,
      userId, previewUrl: `/preview/${userId}/`,
      files: files.map(f => f.originalname)
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.json({ success: false, message: `❌ Error: ${error.message}` });
  }
});

app.get("/api/website/files/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userFolder = path.join(WEBSITES_DIR, userId);
    if (!fsSync.existsSync(userFolder)) return res.json({ success: true, files: [] });
    const files = await fs.readdir(userFolder);
    res.json({ success: true, userId, files, previewUrl: `/preview/${userId}/` });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.delete("/api/website/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userFolder = path.join(WEBSITES_DIR, userId);
    if (!fsSync.existsSync(userFolder)) return res.json({ success: false, message: "❌ Website not found!" });
    await fs.rm(userFolder, { recursive: true, force: true });
    deploymentLog.push({ type: 'website', action: 'deleted', userId, timestamp: new Date().toISOString() });
    res.json({ success: true, message: "✅ Website deleted!" });
  } catch (error) {
    res.json({ success: false, message: `❌ Error: ${error.message}` });
  }
});

app.get("/preview/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userFolder = path.join(WEBSITES_DIR, userId);
    const indexFile = path.join(userFolder, "index.html");
    if (fsSync.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(404).send(`<html><body style="background:#0e0e10;color:white;font-family:sans-serif;text-align:center;padding:50px;"><h1>❌ No Website Found</h1><p>Upload an index.html file first!</p><a href="/" style="color:#5865F2;">← Back to BotForge</a></body></html>`);
    }
  } catch (error) {
    res.status(500).send("❌ Error: " + error.message);
  }
});

app.get("/preview/:userId/:filename", async (req, res) => {
  try {
    const { userId, filename } = req.params;
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).send("❌ Invalid filename!");
    }
    const filePath = path.join(WEBSITES_DIR, userId, filename);
    if (fsSync.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send("❌ File not found!");
    }
  } catch (error) {
    res.status(500).send("❌ Error: " + error.message);
  }
});

app.get("/api/deployments", (req, res) => {
  res.json({ total: deploymentLog.length, recent: deploymentLog.slice(-50).reverse() });
});

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down - cleaning up...');
  for (const [userId, botData] of runningBots.entries()) {
    clearTimeout(botData.timeoutId);
    await botData.bot.stop();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`✅ BotForge v9.0.1 running on port ${PORT}`);
  console.log(`🛡️ vm2 Sandboxing: ENABLED (FIXED)`);
  console.log(`🤖 Discord bot hosting: ACTIVE (1hr timeout)`);
  console.log(`🌐 Website hosting: ACTIVE`);
  console.log(`🔒 Memory limit: ${SECURITY.MAX_MEMORY_MB}MB per bot`);
  console.log(`⏱️ Auto-kill: ${SECURITY.BOT_TIMEOUT_MS / 60000} minutes`);
  console.log(`🚫 Dangerous code patterns: BLOCKED`);
  console.log(`📊 Deployment tracking: ENABLED`);
});
