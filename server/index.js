// BotForge Backend Server
// Handles bot hosting requests with secure token validation

// Import the libraries we need
import express from "express";
import cors from "cors";
import { Client, GatewayIntentBits } from "discord.js";

// Create the Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware: Allow frontend to talk to us
app.use(cors());

// Middleware: Understand JSON data
app.use(express.json());

// ===================================
// ENDPOINT 1: Home page
// Visit: https://your-backend.onrender.com/
// ===================================
app.get("/", (req, res) => {
  res.json({ 
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "1.0.0"
  });
});

// ===================================
// ENDPOINT 2: Health check
// Visit: https://your-backend.onrender.com/health
// ===================================
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    message: "Server is running perfectly! 💚"
  });
});

// ===================================
// ENDPOINT 3: Validate Discord Token
// This checks if a token is REAL or FAKE
// ===================================
app.post("/api/validate-token", async (req, res) => {
  const { token } = req.body;

  // Check if token was provided
  if (!token) {
    return res.json({ 
      valid: false, 
      error: "No token provided",
      message: "❌ Please paste your bot token!"
    });
  }

  // Level 1: Basic format check
  if (token.length < 50) {
    return res.json({ 
      valid: false, 
      error: "Token too short",
      message: "❌ That doesn't look like a real Discord token."
    });
  }

  // Level 2: Try to login with the token
  try {
    console.log("🔍 Checking token validity...");
    
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
    
    console.log("✅ Token is valid! Bot:", botInfo.bot.tag);
    return res.json(botInfo);

  } catch (error) {
    console.log("❌ Invalid token:", error.message);
    
    return res.json({ 
      valid: false, 
      error: "Invalid token",
      message: "❌ This token is invalid. Check the Discord Developer Portal."
    });
  }
});

// ===================================
// ENDPOINT 4: Start a Bot
// ===================================
app.post("/api/bot/start", async (req, res) => {
  const { code, token } = req.body;

  console.log("📝 Bot start request received");
  console.log("   Code length:", code?.length || 0);
  console.log("   Token provided:", token ? "Yes" : "No");

  if (!code) {
    return res.json({ 
      success: false, 
      message: "❌ Please paste your bot code!"
    });
  }

  if (!token) {
    return res.json({ 
      success: false, 
      message: "❌ Please paste your bot token!"
    });
  }

  // Validate the token first
  try {
    const tempClient = new Client({ 
      intents: [GatewayIntentBits.Guilds] 
    });
    await tempClient.login(token);
    const botTag = tempClient.user.tag;
    await tempClient.destroy();

    console.log("✅ Token validated! Bot:", botTag);

    res.json({ 
      success: true, 
      message: `✅ Token valid! Bot: ${botTag}. Bot execution coming soon!`,
      botTag: botTag
    });

  } catch (error) {
    console.log("❌ Token validation failed");
    res.json({ 
      success: false, 
      message: "❌ The token you provided is invalid. Please check it and try again."
    });
  }
});

// ===================================
// ENDPOINT 5: Stop a Bot
// ===================================
app.post("/api/bot/stop", (req, res) => {
  console.log("⏹️ Bot stop request received");
  res.json({ 
    success: true,
    message: "Bot stop endpoint works!"
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`✅ BotForge server running on port ${PORT}`);
  console.log(`🌐 Visit http://localhost:${PORT}`);
});
