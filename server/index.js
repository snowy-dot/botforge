// This is our backend server!
// It will eventually run Discord bots, but for now it just says "Hello!"

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// NEW: Allow our frontend website to talk to this backend
// Without this, the browser blocks the request for security reasons
app.use(cors());

// This lets the server understand JSON data
app.use(express.json());

// Our first "endpoint" - when someone visits the homepage
app.get("/", (req, res) => {
  res.json({ 
    message: "🤖 BotForge Backend is running!",
    status: "online",
    version: "1.0.0"
  });
});

// A test endpoint to make sure things work
app.get("/api/test", (req, res) => {
  res.json({ 
    success: true,
    message: "Backend is working perfectly!"
  });
});

// This is where bots will be started (we'll build this next!)
app.post("/api/bot/start", (req, res) => {
  console.log("✅ Someone wants to start a bot!");
  console.log("📝 Code length:", req.body.code?.length || 0);
  console.log("🔑 Token received:", req.body.token ? "Yes" : "No");
  
  res.json({ 
    success: true,
    message: "Bot start endpoint reached successfully! 🎉"
  });
});

app.post("/api/bot/stop", (req, res) => {
  console.log("⏹️ Someone wants to stop a bot!");
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
// Health check endpoint - used to monitor if the server is alive
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    uptime: process.uptime(), // How long the server has been running (in seconds)
    timestamp: new Date().toISOString(),
    message: "Server is running perfectly! 💚"
  });
});
