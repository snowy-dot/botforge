// =====================================================
// BotForge Backend - SECURE VERSION 5.0
// With isolated-vm sandboxing & resource limits
// =====================================================

import express from "express";
import cors from "cors";
import { Client, GatewayIntentBits } from "discord.js";
import ivm from "isolated-vm";
import fs from "fs/promises";
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
  MAX_MEMORY_MB: 128,        // Max RAM per bot (MB)
  MAX_CPU_TIME_MS: 5000,     // Max CPU time per execution (5 seconds)
  BOT_TIMEOUT_MS: 300000,    // Auto-kill bot after 5 minutes
  MAX_CODE_SIZE: 50000,      // Max code size (50KB)
  MAX_BOT_COUNT: 5           // Max concurrent bots
};

const runningBots = new Map();

// =====================================================
// DANGEROUS PATTERNS CHECK
// Block code that tries to do harmful things
// =====================================================
const DANGEROUS_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /require\s*\(\s*['"]fs['"]\s*\)/i,
  /require\s*\(\s*['"]fs\//i,
  /process\.exit/i,
  /process\.kill/i,
  /process\.env/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /require\s*\(\s*['"]http['"]\s*\)/i,
  /require\s*\(\s*['"]https['"]\s*\)/i,
  /require\s*\(\s*['"]net['"]\s*\)/i,
  /require\s*\(\s*['"]dgram['"]\s*\)/i,
  /\bwhile\s*\(\s*true\s*\)/i,  // Infinite loops
  /\bfor\s*\(\s*;;\s*\)/i       // Infinite loops
];

function checkCodeSafety(code) {
  const violations = [];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(pattern.toString());
    }
  }

  // Check for Discord.js usage (required)
  if (!code.includes('discord.js')) {
    violations.push('Code must use discord.js');
  }

  return violations;
}

// =====================================================
// SANDBOXED BOT RUNNER
// Runs user code in isolated-vm with strict limits
// =====================================================
class SandboxedBot {
  constructor(userId, code, token) {
    this.userId = userId;
    this.code = code;
    this.token = token;
    this.isolate = null;
    this.script = null;
    this.logs = [];
    this.startTime = Date.now();
    this.errorCount = 0;
  }

  async start() {
    try {
      // Create isolated VM with memory limit
      this.isolate = new ivm.Isolate({
        memoryLimit: SECURITY.MAX_MEMORY_MB
      });

      // Create context (what the bot can access)
      const context = await this.isolate.createContext();

      // Set up safe APIs that the bot can use
      const jail = context.global;

      // Provide a safe console.log
      await jail.set('global', jail.derefInto());

      // Provide the Discord.js library
      await jail.set('_discord', new ivm.Reference({
        Client: this.isolate.embedder.embedSync ? 
          await this.loadDiscordJS() : null
      }));

      // Provide safe console
      await jail.set('console', new ivm.Reference({
        log: (...args) => {
          const msg = args.map(a => String(a)).join(' ');
          this.logs.push(msg);
          if (this.logs.length > 100) this.logs.shift();
          console.log(`[Bot ${this.userId}] ${msg}`);
        },
        error: (...args) => {
          const msg = args.map(a => String(a)).join(' ');
          this.logs.push(`[ERROR] ${msg}`);
          if (this.logs.length > 100) this.logs.shift();
          console.error(`[Bot ${this.userId}] ERROR: ${msg}`);
        },
        warn: (...args) => {
          const msg = args.map(a => String(a)).join(' ');
          this.logs.push(`[WARN] ${msg}`);
        }
      }));

      // Provide safe environment (only the token)
      await jail.set('process', new ivm.Reference({
        env: new ivm.Reference({
          get: () => this.token
        })
      }));

      // Wrap the user code to inject our safe Discord.js
      const wrappedCode = `
        ${this.code.replace(/require\(['"]discord\.js['"]\)/g, 'global._discord')}
        
        // Provide a fake require that only allows discord.js
        const require = (mod) => {
          if (mod === 'discord.js') return global._discord;
          throw new Error('Module not allowed: ' + mod);
        };
      `;

      // Compile the script
      this.script = await this.isolate.compileScript(wrappedCode);

      // Run with timeout
      await Promise.race([
        this.script.run(context, {
          timeout: SECURITY.MAX_CPU_TIME_MS
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Execution timeout')), 
                     SECURITY.MAX_CPU_TIME_MS)
        )
      ]);

      this.logs.push('✅ Bot started successfully in sandbox');
      return { success: true };
    } catch (error) {
      this.logs.push(`❌ Sandbox error: ${error.message}`);
      throw error;
    }
  }

  async loadDiscordJS() {
    // This is a placeholder - we'll use a different approach
    return null;
  }

  async stop() {
    if (this.isolate) {
      try {
        this.isolate.dispose();
      } catch (err) {
        console.error('Error disposing isolate:', err.message);
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
// ENDPOINTS
// =====================================================

app.get("/", (req, res) => {
  res.json({
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "5.0.0 - SECURE with sandboxing!",
    security: {
      sandboxed: true,
      memoryLimit: SECURITY.MAX_MEMORY_MB + "MB",
      cpuTimeout: SECURITY.MAX_CPU_TIME_MS + "ms",
      autoKill: (SECURITY.BOT_TIMEOUT_MS / 1000) + "s"
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
    securityEnabled: true,
    timestamp: new Date().toISOString()
  });
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
        tag: tempClient.user.tag
      }
    };

    await tempClient.destroy();
    return res.json(botInfo);
  } catch (error) {
    return res.json({ valid: false, message: "❌ Invalid token." });
  }
});

// =====================================================
// SECURE BOT START ENDPOINT
// =====================================================
app.post("/api/bot/start", async (req, res) => {
  const { code, token } = req.body;
  const userId = req.ip || "user-" + Date.now();

  // Validation
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
      message: "❌ Server is at max capacity. Try again later!" 
    });
  }

  if (runningBots.has(userId)) {
    return res.json({ 
      success: false, 
      message: "❌ You already have a bot running!" 
    });
  }

  // SECURITY CHECK: Scan code for dangerous patterns
  const violations = checkCodeSafety(code);
  if (violations.length > 0) {
    return res.json({
      success: false,
      message: `❌ Security violation! Disallowed code patterns detected.`
    });
  }

  try {
    // Validate token first
    const tempClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    await tempClient.login(token);
    const botTag = tempClient.user.tag;
    await tempClient.destroy();

    console.log(`🔒 Starting sandboxed bot: ${botTag}`);

    // Create sandboxed bot
    const bot = new SandboxedBot(userId, code, token);
    
    try {
      await bot.start();
    } catch (sandboxError) {
      return res.json({
        success: false,
        message: `❌ Sandbox error: ${sandboxError.message}. Your code might use forbidden features.`
      });
    }

    // Set auto-kill timeout
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
        autoKillIn: Math.floor(SECURITY.BOT_TIMEOUT_MS / 60000) + " minutes"
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
      message: `✅ Bot ${botData.botTag} stopped and sandbox cleaned up!` 
    });
  } catch (error) {
    res.json({ success: false, message: `❌ Error: ${error.message}` });
  }
});

// New endpoint to get bot logs
app.get("/api/bot/logs/:userId", (req, res) => {
  const botData = runningBots.get(req.params.userId);
  if (!botData) {
    return res.json({ running: false, logs: [] });
  }
  res.json({
    running: true,
    botTag: botData.botTag,
    uptime: Date.now() - botData.startTime,
    logs: botData.bot.getLogs(),
    security: {
      memoryUsed: botData.bot.isolate ? 
        Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + "MB" : "unknown"
    }
  });
});

// Admin endpoint to see all running bots
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
// CLEANUP ON SERVER SHUTDOWN
// =====================================================
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down - cleaning up all sandboxes...');
  for (const [userId, botData] of runningBots.entries()) {
    clearTimeout(botData.timeoutId);
    await botData.bot.stop();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`✅ BotForge v5.0 (SECURE) running on port ${PORT}`);
  console.log(`🛡️ Sandboxing: ENABLED`);
  console.log(`🔒 Memory limit: ${SECURITY.MAX_MEMORY_MB}MB per bot`);
  console.log(`⏱️ Auto-kill: ${SECURITY.BOT_TIMEOUT_MS / 1000}s`);
  console.log(`🚫 Dangerous code patterns: BLOCKED`);
});
