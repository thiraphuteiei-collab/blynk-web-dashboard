const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BLYNK_BASE_URL = process.env.BLYNK_BASE_URL || "https://blynk.cloud";
const BLYNK_TOKEN = process.env.BLYNK_AUTH_TOKEN || "NUIgGSv_S0Bl2k2liK83WX-4FIjo35wk";
const LOGIN_USERNAME = process.env.LOGIN_USERNAME || "admin";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || "1234";
const HISTORY_INTERVAL_MS = Number(process.env.HISTORY_INTERVAL_MS || 300000);
const HISTORY_MAX_ITEMS = Number(process.env.HISTORY_MAX_ITEMS || 500);
const HISTORY_FILE = path.join(__dirname, "history.json");

if (!BLYNK_TOKEN) {
  console.warn("[WARN] Missing BLYNK_AUTH_TOKEN in environment variables");
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DASHBOARD_CONFIG = {
  deviceName: process.env.DEVICE_NAME || "Quickstart Device",
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

function ensureHistoryFile() {
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, "[]", "utf8");
  }
}

function loadHistory() {
  try {
    ensureHistoryFile();
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const data = JSON.parse(raw);
    historyCache = Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("[HISTORY] Failed to load history:", error.message);
    historyCache = [];
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyCache, null, 2), "utf8");
  } catch (error) {
    console.error("[HISTORY] Failed to save history:", error.message);
  }
}

function addHistory(entry) {
  historyCache.unshift(entry);
  if (historyCache.length > HISTORY_MAX_ITEMS) {
    historyCache = historyCache.slice(0, HISTORY_MAX_ITEMS);
  }
  saveHistory();
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

function computeWaterAlertLabel(rawValue) {
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
      alert: computeWaterAlertLabel(alertRaw)
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
    console.log("[HISTORY] Snapshot saved:", snapshot.updatedAt);
  } catch (error) {
    console.error("[HISTORY] Snapshot failed:", error.message);
  }
}

app.get("/api/config", (req, res) => {
  res.json({ success: true, config: DASHBOARD_CONFIG });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
    return res.json({
      success: true,
      token: "logged-in",
      username: LOGIN_USERNAME
    });
  }

  return res.status(401).json({
    success: false,
    error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
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
      error: error.message || "Failed to fetch Blynk data"
    });
  }
});

app.get("/api/history", (req, res) => {
  res.json({
    success: true,
    intervalMs: HISTORY_INTERVAL_MS,
    count: historyCache.length,
    items: historyCache
  });
});

app.post("/api/toggle/pump", async (req, res) => {
  try {
    if (!BLYNK_TOKEN) {
      return res.status(500).json({ success: false, error: "BLYNK_AUTH_TOKEN is missing" });
    }

    const nextValue = req.body?.value ? 1 : 0;
    await setValue(DASHBOARD_CONFIG.pins.pump, nextValue);
    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Failed to update pump" });
  }
});

app.post("/api/toggle/auto-mode", async (req, res) => {
  try {
    if (!BLYNK_TOKEN) {
      return res.status(500).json({ success: false, error: "BLYNK_AUTH_TOKEN is missing" });
    }

    const nextValue = req.body?.value ? 1 : 0;
    await setValue(DASHBOARD_CONFIG.pins.autoMode, nextValue);
    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "Failed to update auto mode" });
  }
});

loadHistory();
collectHistorySnapshot();
setInterval(collectHistorySnapshot, HISTORY_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
