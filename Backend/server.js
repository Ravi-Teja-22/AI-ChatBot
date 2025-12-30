import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const userSchema = new mongoose.Schema({
  fullName: String,
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
});

const chatSchema = new mongoose.Schema({
  username: String,
  user: String,
  bot: String,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Chat = mongoose.model("Chat", chatSchema);

mongoose
  .connect(process.env.MONGO_URI, { dbName: process.env.DB_NAME })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

app.post("/register", async (req, res) => {
  try {
    const { fullName, username, password } = req.body;
    if (!fullName || !username || !password)
      return res.status(400).json({ success: false, message: "All fields required" });

    const existingUser = await User.findOne({ username });
    if (existingUser)
      return res.status(400).json({ success: false, message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ fullName, username, password: hashedPassword });
    await newUser.save();

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: "All fields required" });

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Incorrect password" });

    res.json({ success: true, message: "Login successful", username: user.username });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

async function getAI21Response(message) {
  const payload = {
    model: "jamba-mini", 
    messages: [{ role: "user", content: message }],
    max_tokens: 256,
  };

  const resp = await fetch("https://api.ai21.com/studio/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AI21_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("AI21 response error:", errText);
    throw new Error(`AI21 error: ${resp.status}`);
  }

  const json = await resp.json();
  const reply = json?.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) {
    console.error("AI21 malformed reply:", JSON.stringify(json, null, 2));
    throw new Error("AI21 returned no content");
  }

  return reply;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, username } = req.body;
    if (!message) return res.status(400).json({ reply: "Message required" });

    let reply;
    try {
      reply = await getAI21Response(message);
    } catch (aiErr) {
      console.error("AI21 chat error:", aiErr);
      reply = "⚠️ Sorry, I couldn't process that right now. Please try again later.";
    }

    if (username) {
      const chatEntry = new Chat({ username, user: message, bot: reply });
      await chatEntry.save();
    }

    res.json({ reply });
  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ reply: "⚠️ Error processing your request." });
  }
});

app.get("/api/history", async (req, res) => {
  const username = req.query.username;
  if (!username) return res.json([]);

  try {
    const history = await Chat.find({ username }).sort({ createdAt: 1 });
    res.json(history);
  } catch (err) {
    console.error("❌ History fetch error:", err);
    res.status(500).json([]);
  }
});

app.get("/api/chat/test", (req, res) => {
  res.json({ message: "✅ Chat API is working!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
