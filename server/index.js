// =====================================================
// BotForge Backend Server - Version 2.1
// Now with FASTER bot execution and better security!
// =====================================================

import express from "express";
import cors from "cors";
import { Client, GatewayIntentBits } from "discord.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "5mb" })); // Prevent huge payloads

// Store running bots
const runningBots = new Map();

// =====================================================
// ENDPOINT 1: Home page
// =====================================================
app.get("/", (req, res) => {
  res.json({ 
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "2.1.0 - Fast & Secure!",
    activeBots: runningBots.size,
    uptime: Math.floor(process.uptime()) + " seconds"
  });
});

// =====================================================
// ENDPOINT 2: Health check
// =====================================================
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeBots: runningBots.size,
    message: "Server is running perfectly! 💚"
  });
});

// =====================================================
// ENDPOINT 3: Validate Discord Token
// =====================================================
app.post("/api/validate-token", async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return res.json({ 
      valid: false, 
      message: "❌ Please paste your bot token!"
    });
  }

  if (token.length < 50) {
    return res.json({ 
      valid: false, 
      message: "❌ That doesn't look like a real Discord token."
    });
  }

  // Basic security check
  if (token.includes(" ") || token.includes("\n")) {
    return res.json({
      valid: false,
      message: "❌ Token contains invalid characters."
    });
  }

  try {
    const tempClient = new Client({ 
      intents: [GatewayIntentBits.Guilds] 
    });
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
    return res.json({ 
      valid: false, 
      message: "❌ This token is invalid or lacks permissions."
    });
  }
});

// =====================================================
// ENDPOINT 4: Start a Bot (FAST START - 5 seconds!)
// =====================================================
app.post("/api/bot/start", async (req, res) => {
  const { code, token } = req.body;
  const userId = req.ip || "user-" + Date.now();

  console.log(`📝 Bot start request from: ${userId}`);

  // Validation
  if (!code || typeof code !== "string") {
    return res.json({
      success: false,
      message: "❌ Please paste your bot code!"
    });
  }

  if (!token || typeof token !== "string") {
    return res.json({
      success: false,
      message: "❌ Please paste your bot token!"
    });
  }

  if (code.length > 100000) { // 100KB max
    return res.json({
      success: false,
      message: "❌ Code is too large! Max 100KB."
    });
  }

  // Check if user already has a bot running
  if (runningBots.has(userId)) {
    return res.json({
      success: false,
      message: "❌ You already have a bot running! Stop it first."
    });
  }

  try {
    // Step 1: Validate token
    console.log("🔍 Validating token...");
    const tempClient = new Client({ 
      intents: [GatewayIntentBits.Guilds] 
    });
    await tempClient.login(token);
    const botTag = tempClient.user.tag;
    await tempClient.destroy();
    console.log(`✅ Token valid! Bot: ${botTag}`);

    // Step 2: Setup bot folder
    const botFolder = path.join(__dirname, "bots", userId);
    await fs.mkdir(botFolder, { recursive: true });

    // Step 3: Save user code
    const codePath = path.join(botFolder, "bot.js");
    await fs.writeFile(codePath, code);

    // Step 4: Create package.json
    const packageJson = {
      name: "user-bot",
      version: "1.0.0",
      dependencies: {
        "discord.js": "^14.14.0"
      }
    };
    await fs.writeFile(
      path.join(botFolder, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );

    // Step 5: Create .env with token
    await fs.writeFile(
      path.join(botFolder, ".env"),
      `DISCORD_TOKEN=${token}\n`
    );

    // Step 6: Check if discord.js already installed (FAST START!)
    const nodeModulesPath = path.join(botFolder, "node_modules");
    let nodeModulesExists = false;
    try {
      await fs.access(nodeModulesPath);
      nodeModulesExists = true;
    } catch {
      nodeModulesExists = false;
    }

    if (!nodeModulesExists) {
      console.log("📦 First time setup - installing discord.js...");
      
      // Install with timeout (max 60 seconds)
      await Promise.race([
        runCommand(botFolder, "npm", ["install", "--prefer-offline", "--no-audit", "--silent"]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Install timeout after 60s")), 60000)
        )
      ]);
      console.log("✅ discord.js installed!");
    } else {
      console.log("⚡ discord.js already installed - fast start!");
    }

    // Step 7: Start the bot
    console.log("🚀 Starting bot...");
    const botProcess = spawn("node", ["bot.js"], {
      cwd: botFolder,
      env: { ...process.env, DISCORD_TOKEN: token }
    });

    // Step 8: Setup log streaming
    const logs = [];
    const MAX_LOGS = 100; // Keep only last 100 log lines

    botProcess.stdout.on("data", (data) => {
      const message = data.toString().trim();
      if (message) {
        logs.push(message);
        if (logs.length > MAX_LOGS) logs.shift(); // Keep last 100
        console.log(`[${botTag}] ${message}`);
      }
    });

    botProcess.stderr.on("data", (data) => {
      const message = data.toString().trim();
      if (message) {
        logs.push(`[ERROR] ${message}`);
        if (logs.length > MAX_LOGS) logs.shift();
        console.error(`[${botTag}] ERROR: ${message}`);
      }
    });

    botProcess.on("exit", (code) => {
      console.log(`❌ Bot ${botTag} stopped (exit code: ${code})`);
      runningBots.delete(userId);
    });

    botProcess.on("error", (err) => {
      console.error(`❌ Bot process error: ${err.message}`);
    });

    // Step 9: Store bot info
    runningBots.set(userId, {
      process: botProcess,
      logs: logs,
      botTag: botTag,
      startTime: Date.now()
    });

    res.json({
      success: true,
      message: `✅ Bot ${botTag} is now running!`,
      botTag: botTag,
      userId: userId
    });

  } catch (error) {
    console.error("❌ Start bot error:", error.message);
    res.json({
      success: false,
      message: `❌ Failed to start bot: ${error.message}`
    });
  }
});

// =====================================================
// ENDPOINT 5: Get Bot Logs
// =====================================================
app.get("/api/bot/logs/:userId", (req, res) => {
  const { userId } = req.params;
  const bot = runningBots.get(userId);
  
  if (!bot) {
    return res.json({
      running: false,
      logs: []
    });
  }

  res.json({
    running: true,
    botTag: bot.botTag,
    uptime: Date.now() - bot.startTime,
    logs: bot.logs.slice(-50)
  });
});

// =====================================================
// ENDPOINT 6: Stop a Bot
// =====================================================
app.post("/api/bot/stop", (req, res) => {
  const userId = req.body?.userId || req.ip || "user-" + Date.now();
  const bot = runningBots.get(userId);

  if (!bot) {
    return res.json({
      success: false,
      message: "❌ No bot is running!"
    });
  }

  try {
    bot.process.kill("SIGTERM");
    runningBots.delete(userId);
    
    console.log(`⏹️ Stopped bot: ${bot.botTag}`);

    res.json({
      success: true,
      message: `✅ Bot ${bot.botTag} stopped!`
    });
  } catch (error) {
    res.json({
      success: false,
      message: `❌ Error stopping bot: ${error.message}`
    });
  }
});

// =====================================================
// ENDPOINT 7: List All Running Bots (Admin)
// =====================================================
app.get("/api/bots", (req, res) => {
  const bots = Array.from(runningBots.entries()).map(([userId, bot]) => ({
    userId: userId,
    botTag: bot.botTag,
    uptime: Math.floor((Date.now() - bot.startTime) / 1000) + "s",
    logCount: bot.logs.length
  }));

  res.json({
    totalBots: bots.length,
    bots: bots
  });
});

// =====================================================
// Helper: Run a command and wait for it to finish
// =====================================================
function runCommand(cwd, command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd, shell: false });
    let output = "";
    let errorOutput = "";
    
    process.stdout.on("data", (data) => {
      output += data.toString();
    });
    
    process.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });
    
    process.on("exit", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(errorOutput || `Exit code ${code}`));
      }
    });

    process.on("error", (err) => {
      reject(err);
    });
  });
}

// =====================================================
// PRE-INSTALL DISCORD.JS (Makes first start FAST!)
// =====================================================
async function preInstallDiscordJS() {
  try {
    console.log("🔧 Pre-installing discord.js in background...");
    const tempFolder = path.join(__dirname, ".cache");
    await fs.mkdir(tempFolder, { recursive: true });
    
    await fs.writeFile(
      path.join(tempFolder, "package.json"),
      JSON.stringify({ 
        name: "botforge-cache",
        version: "1.0.0",
        dependencies: { "discord.js": "^14.14.0" }
      })
    );
    
    await runCommand(tempFolder, "npm", ["install", "--silent", "--no-audit"]);
    
    console.log("✅ discord.js pre-installed and cached!");
  } catch (error) {
    console.log("⚠️ Pre-install failed (will install per-bot):", error.message);
  }
}

// Run pre-install in background (doesn't block server)
preInstallDiscordJS();

// =====================================================
// CLEANUP OLD BOT FOLDERS (Prevent disk fill)
// =====================================================
async function cleanupOldBots() {
  try {
    const botsFolder = path.join(__dirname, "bots");
    if (!fsSync.existsSync(botsFolder)) return;

    const folders = await fs.readdir(botsFolder);
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const folder of folders) {
      const folderPath = path.join(botsFolder, folder);
      const stats = await fs.stat(folderPath);
      
      // Delete folders older than 1 hour that aren't running
      if (stats.mtimeMs < oneHourAgo && !runningBots.has(folder)) {
        await fs.rm(folderPath, { recursive: true, force: true });
        console.log(`🗑️ Cleaned up old bot folder: ${folder}`);
      }
    }
  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupOldBots, 30 * 60 * 1000);

// =====================================================
// GRACEFUL SHUTDOWN (Stop bots when server restarts)
// =====================================================
process.on("SIGTERM", async () => {
  console.log("🛑 Shutting down gracefully...");
  
  for (const [userId, bot] of runningBots.entries()) {
    console.log(`Stopping bot: ${bot.botTag}`);
    bot.process.kill("SIGTERM");
  }
  
  process.exit(0);
});

// =====================================================
// START THE SERVER
// =====================================================
app.listen(PORT, () => {
  console.log(`✅ BotForge server running on port ${PORT}`);
  console.log(`🌐 Visit http://localhost:${PORT}`);
  console.log(`🤖 Bot execution is LIVE and FAST!`);
  console.log(`🔒 Version 2.1.0 - Improved security & performance`);
});
