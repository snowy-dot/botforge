// =====================================================
// BotForge Backend Server - Version 2.0
// Now with ACTUAL BOT EXECUTION!
// =====================================================

import express from "express";
import cors from "cors";
import { Client, GatewayIntentBits } from "discord.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Store running bots (in memory for now)
const runningBots = new Map();

// =====================================================
// ENDPOINT 1: Home page
// =====================================================
app.get("/", (req, res) => {
  res.json({ 
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "2.0.0 - Now with bot execution!",
    activeBots: runningBots.size
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

  if (!token) {
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
      message: "❌ This token is invalid."
    });
  }
});

// =====================================================
// ENDPOINT 4: Start a Bot (NOW WITH EXECUTION!)
// =====================================================
app.post("/api/bot/start", async (req, res) => {
  const { code, token } = req.body;
  const userId = req.ip || "user-" + Date.now(); // Simple user tracking

  console.log("📝 Bot start request from:", userId);

  // Check if this user already has a bot running
  if (runningBots.has(userId)) {
    return res.json({
      success: false,
      message: "❌ You already have a bot running! Stop it first."
    });
  }

  // Validate inputs
  if (!code || !token) {
    return res.json({
      success: false,
      message: "❌ Please provide both code and token!"
    });
  }

  // Validate token first
  try {
    const tempClient = new Client({ 
      intents: [GatewayIntentBits.Guilds] 
    });
    await tempClient.login(token);
    const botTag = tempClient.user.tag;
    await tempClient.destroy();

    console.log("✅ Token valid! Bot:", botTag);

    // Create a folder for this bot
    const botFolder = path.join(__dirname, "bots", userId);
    await fs.mkdir(botFolder, { recursive: true });

    // Save the user's code
    const codePath = path.join(botFolder, "bot.js");
    await fs.writeFile(codePath, code);

    // Create package.json for the bot
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

    // Create .env file with the token
    await fs.writeFile(
      path.join(botFolder, ".env"),
      `DISCORD_TOKEN=${token}\n`
    );

    // Install dependencies
    console.log("📦 Installing discord.js...");
    await runCommand(botFolder, "npm", ["install"]);

    // Start the bot
    console.log("🚀 Starting bot...");
    const botProcess = spawn("node", ["bot.js"], {
      cwd: botFolder,
      env: { ...process.env, DISCORD_TOKEN: token }
    });

    // Store the bot process
    const logs = [];
    botProcess.stdout.on("data", (data) => {
      const message = data.toString();
      logs.push(message);
      console.log(`[${botTag}] ${message}`);
    });

    botProcess.stderr.on("data", (data) => {
      const message = data.toString();
      logs.push(`[ERROR] ${message}`);
      console.error(`[${botTag}] ${message}`);
    });

    botProcess.on("exit", (code) => {
      console.log(`❌ Bot ${botTag} stopped with code ${code}`);
      runningBots.delete(userId);
    });

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
    console.error("❌ Error:", error.message);
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
    logs: bot.logs.slice(-50) // Last 50 lines
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

  // Kill the bot process
  bot.process.kill();
  runningBots.delete(userId);

  console.log(`⏹️ Stopped bot: ${bot.botTag}`);

  res.json({
    success: true,
    message: `✅ Bot ${bot.botTag} stopped!`
  });
});

// =====================================================
// Helper: Run a command and wait for it to finish
// =====================================================
function runCommand(cwd, command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd });
    let output = "";
    
    process.stdout.on("data", (data) => {
      output += data.toString();
    });
    
    process.stderr.on("data", (data) => {
      output += data.toString();
    });
    
    process.on("exit", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Command failed: ${output}`));
      }
    });
  });
}

// =====================================================
// START THE SERVER
// =====================================================
app.listen(PORT, () => {
  console.log(`✅ BotForge server running on port ${PORT}`);
  console.log(`🌐 Visit http://localhost:${PORT}`);
  console.log(`🤖 Bot execution is now LIVE!`);
});
