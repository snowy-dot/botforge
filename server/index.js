// =====================================================
// BotForge Backend - Simple & Clean (No Login Required)
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

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const runningBots = new Map();

// =====================================================
// ENDPOINTS
// =====================================================
app.get("/", (req, res) => {
  res.json({ 
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "4.0.0 - Simple & Clean!",
    activeBots: runningBots.size
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    uptime: process.uptime(),
    activeBots: runningBots.size
  });
});

app.post("/api/validate-token", async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return res.json({ valid: false, message: "❌ Please paste your bot token!" });
  }

  if (token.length < 50) {
    return res.json({ valid: false, message: "❌ That doesn't look like a real Discord token." });
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
    return res.json({ valid: false, message: "❌ This token is invalid." });
  }
});

app.post("/api/bot/start", async (req, res) => {
  const { code, token } = req.body;
  const userId = req.ip || "user-" + Date.now();

  if (!code || !token) {
    return res.json({ success: false, message: "❌ Please provide code and token!" });
  }

  if (runningBots.has(userId)) {
    return res.json({ success: false, message: "❌ You already have a bot running!" });
  }

  try {
    const tempClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    await tempClient.login(token);
    const botTag = tempClient.user.tag;
    await tempClient.destroy();

    const botFolder = path.join(__dirname, "bots", userId);
    await fs.mkdir(botFolder, { recursive: true });
    await fs.writeFile(path.join(botFolder, "bot.js"), code);
    await fs.writeFile(path.join(botFolder, "package.json"), 
      JSON.stringify({ name: "user-bot", dependencies: { "discord.js": "^14.14.0" } })
    );
    await fs.writeFile(path.join(botFolder, ".env"), `DISCORD_TOKEN=${token}\n`);

    const nodeModulesPath = path.join(botFolder, "node_modules");
    let exists = false;
    try { await fs.access(nodeModulesPath); exists = true; } catch {}

    if (!exists) {
      await Promise.race([
        runCommand(botFolder, "npm", ["install", "--prefer-offline", "--no-audit", "--silent"]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Install timeout")), 60000))
      ]);
    }

    const botProcess = spawn("node", ["bot.js"], {
      cwd: botFolder,
      env: { ...process.env, DISCORD_TOKEN: token }
    });

    const logs = [];
    botProcess.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) { logs.push(msg); if (logs.length > 100) logs.shift(); }
    });
    botProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) { logs.push(`[ERROR] ${msg}`); if (logs.length > 100) logs.shift(); }
    });
    botProcess.on("exit", () => runningBots.delete(userId));

    runningBots.set(userId, { process: botProcess, logs, botTag, startTime: Date.now() });

    res.json({ success: true, message: `✅ Bot ${botTag} is online 24/7!`, botTag });
  } catch (error) {
    res.json({ success: false, message: `❌ Failed: ${error.message}` });
  }
});

app.post("/api/bot/stop", (req, res) => {
  const userId = req.ip || "user-" + Date.now();
  const bot = runningBots.get(userId);

  if (!bot) return res.json({ success: false, message: "❌ No bot running!" });

  try {
    bot.process.kill("SIGTERM");
    runningBots.delete(userId);
    res.json({ success: true, message: `✅ Bot ${bot.botTag} stopped!` });
  } catch (error) {
    res.json({ success: false, message: `❌ Error: ${error.message}` });
  }
});

function runCommand(cwd, command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd });
    let output = "", errorOutput = "";
    process.stdout.on("data", (data) => output += data.toString());
    process.stderr.on("data", (data) => errorOutput += data.toString());
    process.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(errorOutput)));
    process.on("error", reject);
  });
}

app.listen(PORT, () => {
  console.log(`✅ BotForge v4.0 running on port ${PORT}`);
  console.log(`🤖 Keep your bot online 24/7 - no login needed!`);
});
