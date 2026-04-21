const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const BLYNK_BASE_URL = process.env.BLYNK_BASE_URL || "https://blynk.cloud";
const BLYNK_TOKEN = process.env.BLYNK_AUTH_TOKEN || "";
const HISTORY_INTERVAL_MS = Number(process.env.HISTORY_INTERVAL_MS || 300000);
const HISTORY_MAX_ITEMS = Number(process.env.HISTORY_MAX_ITEMS || 500);

const USERS_FILE = path.join(__dirname, "users.json");
const HISTORY_FILE = path.join(__dirname, "history.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG = {
  deviceName: process.env.DEVICE_NAME || "Smart Watering Control",
  refreshMs: Number(process.env.REFRESH_MS || 5000),
  pins: {
    pump: process.env.PIN_PUMP || "v0",
    soil: process.env.PIN_SOIL || "v1",
    water: process.env.PIN_WATER || "v2",
    temp: process.env.PIN_TEMP || "v3",
    autoMode: process.env.PIN_AUTO_MODE || "v4",
    alert: process.env.PIN_ALERT || "v5"
  }
};

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

function readJson(filePath, fallback) {
  try {
    ensureJsonFile(filePath, fallback);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    loginCount: user.loginCount || 0
  };
}

function findUserByEmail(email) {
  const users = readJson(USERS_FILE, []);
  return users.find((u) => String(u.email || "").toLowerCase() === String(email || "").toLowerCase());
}

function findUserById(id) {
  const users = readJson(USERS_FILE, []);
  return users.find((u) => u.id === id);
}

function updateUser(updatedUser) {
  const users = readJson(USERS_FILE, []);
  const index = users.findIndex((u) => u.id === updatedUser.id);
  if (index !== -1) {
    users[index] = updatedUser;
    writeJson(USERS_FILE, users);
  }
}

function normalizePin(pin) {
  return String(pin || "").toLowerCase();
}

function buildGetUrl(pin) {
  return `${BLYNK_BASE_URL}/external/api/get?token=${encodeURIComponent(BLYNK_TOKEN)}&${normalizePin(pin)}`;
}

function buildUpdateUrl(pin, value) {
  return `${BLYNK_BASE_URL}/external/api/update?token=${encodeURIComponent(BLYNK_TOKEN)}&${normalizePin(pin)}=${encodeURIComponent(value)}`;
}

async function fetchText(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text;
}

async function getValue(pin) {
  return fetchText(buildGetUrl(pin));
}

async function setValue(pin, value) {
  return fetchText(buildUpdateUrl(pin, value));
}

function parseBooleanLike(value) {
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

function parseNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function computeAlertLabel(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (["0", "low", "empty", "น้ำหมด", "น้ำต่ำ", "near empty", "ใกล้หมด"].includes(value)) return "Water low";
  if (["1", "normal", "ok", "น้ำปกติ"].includes(value)) return "Normal";
  return rawValue || "-";
}

async function fetchSnapshot() {
  if (!BLYNK_TOKEN) throw new Error("BLYNK_AUTH_TOKEN is missing");

  const { pump, soil, water, temp, autoMode, alert } = CONFIG.pins;

  const [pumpRaw, soilRaw, waterRaw, tempRaw, autoModeRaw, alertRaw] = await Promise.all([
    getValue(pump),
    getValue(soil),
    getValue(water),
    getValue(temp),
    getValue(autoMode),
    getValue(alert)
  ]);

  return {
    updatedAt: new Date().toISOString(),
    values: {
      pump: parseBooleanLike(pumpRaw),
      soil: parseNumber(soilRaw),
      water: parseNumber(waterRaw),
      temp: parseNumber(tempRaw),
      autoMode: parseBooleanLike(autoModeRaw),
      alert: computeAlertLabel(alertRaw)
    }
  };
}

function addHistory(message, extra = {}) {
  const items = readJson(HISTORY_FILE, []);
  items.unshift({
    id: `log_${Date.now()}`,
    time: new Date().toISOString(),
    message,
    ...extra
  });
  writeJson(HISTORY_FILE, items.slice(0, HISTORY_MAX_ITEMS));
}

async function collectHistorySnapshot() {
  try {
    const snap = await fetchSnapshot();
    addHistory("System snapshot updated", { values: snap.values });
  } catch {}
}

app.get("/", (req, res) => res.redirect("/login.html"));

app.get("/api/config", (req, res) => {
  res.json({
    success: true,
    config: {
      deviceName: CONFIG.deviceName,
      refreshMs: CONFIG.refreshMs
    }
  });
});

app.post("/api/register", (req, res) => {
  const fullName = String(req.body?.fullName || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (!fullName || !email || !username || !password) {
    return res.status(400).json({ success: false, error: "Please fill in all fields" });
  }

  if (!email.includes("@")) {
    return res.status(400).json({ success: false, error: "Invalid email" });
  }

  const users = readJson(USERS_FILE, []);

  if (users.some((u) => u.email === email)) {
    return res.status(400).json({ success: false, error: "Email already exists" });
  }

  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ success: false, error: "Username already exists" });
  }

  const now = new Date().toISOString();
  const newUser = {
    id: `user_${Date.now()}`,
    fullName,
    email,
    username,
    password,
    createdAt: now,
    lastLoginAt: now,
    loginCount: 0
  };

  users.push(newUser);
  writeJson(USERS_FILE, users);

  return res.json({ success: true, message: "Register successful" });
});

app.post("/api/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();

  const user = findUserByEmail(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: "Email or password is incorrect" });
  }

  user.lastLoginAt = new Date().toISOString();
  user.loginCount = Number(user.loginCount || 0) + 1;
  updateUser(user);

  return res.json({
    success: true,
    token: `token_${user.id}`,
    user: sanitizeUser(user)
  });
});

app.get("/api/profile/:id", (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }
  res.json({ success: true, user: sanitizeUser(user) });
});

app.put("/api/profile/:id", (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  const fullName = String(req.body?.fullName || "").trim();
  const username = String(req.body?.username || "").trim();

  if (!fullName || !username) {
    return res.status(400).json({ success: false, error: "Full name and username are required" });
  }

  user.fullName = fullName;
  user.username = username;
  updateUser(user);

  res.json({ success: true, user: sanitizeUser(user) });
});

app.put("/api/profile/:id/password", (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  const currentPassword = String(req.body?.currentPassword || "").trim();
  const newPassword = String(req.body?.newPassword || "").trim();

  if (user.password !== currentPassword) {
    return res.status(400).json({ success: false, error: "Current password is incorrect" });
  }

  if (!newPassword) {
    return res.status(400).json({ success: false, error: "New password is required" });
  }

  user.password = newPassword;
  updateUser(user);

  res.json({ success: true, message: "Password updated" });
});

app.get("/api/status", async (req, res) => {
  try {
    const snap = await fetchSnapshot();
    res.json({ success: true, ...snap });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Failed to fetch status" });
  }
});

app.get("/api/history", (req, res) => {
  const items = readJson(HISTORY_FILE, []);
  res.json({ success: true, items });
});

app.post("/api/toggle/pump", async (req, res) => {
  try {
    const nextValue = req.body?.value ? 1 : 0;
    await setValue(CONFIG.pins.pump, nextValue);
    addHistory(nextValue ? "Pump turned ON" : "Pump turned OFF");
    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Failed to update pump" });
  }
});

app.post("/api/toggle/auto-mode", async (req, res) => {
  try {
    const nextValue = req.body?.value ? 1 : 0;
    await setValue(CONFIG.pins.autoMode, nextValue);
    addHistory(nextValue ? "Auto mode enabled" : "Auto mode disabled");
    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Failed to update auto mode" });
  }
});

ensureJsonFile(USERS_FILE, []);
ensureJsonFile(HISTORY_FILE, []);
collectHistorySnapshot();
setInterval(collectHistorySnapshot, HISTORY_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
