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

const HISTORY_FILE = path.join(__dirname, "history.json");
const USERS_FILE = path.join(__dirname, "users.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DASHBOARD_CONFIG = {
  deviceName: process.env.DEVICE_NAME || "Smart Garden Dashboard",
  refreshMs: Number(process.env.REFRESH_MS || 5000),
  historyIntervalMs: HISTORY_INTERVAL_MS,
  pins: {
    pump: process.env.PIN_PUMP || "v0",
    autoMode: process.env.PIN_AUTO_MODE || "v4",
    soil: process.env.PIN_SOIL || "v1",
    water: process.env.PIN_WATER || "v2",
    temp: process.env.PIN_TEMP || "v3",
    alert: process.env.PIN_ALERT || "v5"
  },
  ranges: {
    soilMin: Number(process.env.SOIL_MIN || 0),
    soilMax: Number(process.env.SOIL_MAX || 4095),
    waterMin: Number(process.env.WATER_MIN || 0),
    waterMax: Number(process.env.WATER_MAX || 4095),
    tempMin: Number(process.env.TEMP_MIN || 0),
    tempMax: Number(process.env.TEMP_MAX || 100)
  }
};

let historyCache = [];
let usersCache = [];

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

function loadHistory() {
  try {
    ensureJsonFile(HISTORY_FILE, []);
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const data = JSON.parse(raw);
    historyCache = Array.isArray(data) ? data : [];
  } catch {
    historyCache = [];
  }
}

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyCache, null, 2), "utf8");
}

function addHistory(entry) {
  historyCache.unshift(entry);
  if (historyCache.length > HISTORY_MAX_ITEMS) {
    historyCache = historyCache.slice(0, HISTORY_MAX_ITEMS);
  }
  saveHistory();
}

function loadUsers() {
  try {
    ensureJsonFile(USERS_FILE, []);
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const data = JSON.parse(raw);
    usersCache = Array.isArray(data) ? data : [];
  } catch {
    usersCache = [];
  }
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersCache, null, 2), "utf8");
}

function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    loginCount: user.loginCount || 0
  };
}

function findUserByUsername(username) {
  return usersCache.find(
    (u) => String(u.username || "").toLowerCase() === String(username || "").toLowerCase()
  );
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

  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }

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

  if (["0", "low", "empty", "น้ำหมด", "น้ำต่ำ"].includes(value)) {
    return "น้ำต่ำ";
  }

  if (["1", "normal", "ok", "น้ำปกติ"].includes(value)) {
    return "น้ำปกติ";
  }

  return rawValue || "-";
}

async function fetchBlynkSnapshot() {
  if (!BLYNK_TOKEN) {
    throw new Error("BLYNK_AUTH_TOKEN is missing");
  }

  const { pump, autoMode, soil, water, temp, alert } = DASHBOARD_CONFIG.pins;

  const [pumpRaw, autoModeRaw, soilRaw, waterRaw, tempRaw, alertRaw] = await Promise.all([
    getValue(pump),
    getValue(autoMode),
    getValue(soil),
    getValue(water),
    getValue(temp),
    getValue(alert)
  ]);

  return {
    deviceName: DASHBOARD_CONFIG.deviceName,
    updatedAt: new Date().toISOString(),
    values: {
      pump: parseBooleanLike(pumpRaw),
      autoMode: parseBooleanLike(autoModeRaw),
      soil: parseNumber(soilRaw),
      water: parseNumber(waterRaw),
      temp: parseNumber(tempRaw),
      alert: computeAlertLabel(alertRaw)
    }
  };
}

async function collectHistorySnapshot() {
  try {
    const snapshot = await fetchBlynkSnapshot();
    addHistory({
      timestamp: snapshot.updatedAt,
      values: snapshot.values
    });
  } catch (error) {
    console.error("[HISTORY]", error.message);
  }
}

app.get("/api/config", (req, res) => {
  res.json({ success: true, config: DASHBOARD_CONFIG });
});

app.post("/api/register", (req, res) => {
  const fullName = String(req.body?.fullName || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (!fullName || !email || !username || !password) {
    return res.status(400).json({
      success: false,
      error: "กรอกข้อมูลให้ครบ"
    });
  }

  if (!email.includes("@")) {
    return res.status(400).json({
      success: false,
      error: "อีเมลไม่ถูกต้อง"
    });
  }

  const usernameExists = usersCache.some(
    (u) => String(u.username || "").toLowerCase() === username.toLowerCase()
  );

  if (usernameExists) {
    return res.status(400).json({
      success: false,
      error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว"
    });
  }

  const emailExists = usersCache.some(
    (u) => String(u.email || "").toLowerCase() === email
  );

  if (emailExists) {
    return res.status(400).json({
      success: false,
      error: "อีเมลนี้ถูกใช้แล้ว"
    });
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

  usersCache.push(newUser);
  saveUsers();

  return res.json({
    success: true,
    message: "สมัครสมาชิกสำเร็จ"
  });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  const user = findUserByUsername(username);

  if (!user || user.password !== password) {
    return res.status(401).json({
      success: false,
      error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
    });
  }

  user.lastLoginAt = new Date().toISOString();
  user.loginCount = Number(user.loginCount || 0) + 1;
  saveUsers();

  return res.json({
    success: true,
    token: "logged-in",
    user: sanitizeUser(user)
  });
});

app.get("/api/status", async (req, res) => {
  try {
    const snapshot = await fetchBlynkSnapshot();
    res.json({
      success: true,
      ...snapshot
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch status"
    });
  }
});

app.get("/api/history", (req, res) => {
  res.json({
    success: true,
    items: historyCache
  });
});

app.post("/api/toggle/pump", async (req, res) => {
  try {
    const nextValue = req.body?.value ? 1 : 0;
    await setValue(DASHBOARD_CONFIG.pins.pump, nextValue);
    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update pump"
    });
  }
});

app.post("/api/toggle/auto-mode", async (req, res) => {
  try {
    const nextValue = req.body?.value ? 1 : 0;
    await setValue(DASHBOARD_CONFIG.pins.autoMode, nextValue);
    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update auto mode"
    });
  }
});

loadHistory();
loadUsers();
collectHistorySnapshot();
setInterval(collectHistorySnapshot, HISTORY_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
