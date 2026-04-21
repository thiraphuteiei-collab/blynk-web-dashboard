const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
const RESET_TOKENS_FILE = path.join(__dirname, "reset_tokens.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG = {
  deviceName: process.env.DEVICE_NAME || "ระบบควบคุมรดน้ำอัจฉริยะ",
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

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function computeAlertLabel(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();

  if (["0", "low", "empty", "near empty", "น้ำหมด", "น้ำต่ำ", "ใกล้หมด"].includes(value)) {
    return "น้ำใกล้หมด";
  }

  if (["1", "normal", "ok", "น้ำปกติ"].includes(value)) {
    return "น้ำปกติ";
  }

  return rawValue || "-";
}

function sensorText(type, value) {
  if (type === "soil") {
    if (value <= 300) return "ดินแห้งมาก";
    if (value <= 1200) return "ดินค่อนข้างแห้ง";
    if (value <= 2500) return "ดินชื้นปานกลาง";
    return "ดินชื้นมาก";
  }

  if (type === "water") {
    if (value <= 300) return "น้ำในถังต่ำ";
    if (value <= 1200) return "น้ำเหลือน้อย";
    if (value <= 2500) return "น้ำอยู่ในระดับปานกลาง";
    return "น้ำอยู่ในระดับดี";
  }

  if (type === "temp") {
    if (value < 20) return "อุณหภูมิค่อนข้างต่ำ";
    if (value <= 32) return "อุณหภูมิปกติ";
    if (value <= 38) return "อุณหภูมิสูงกว่าปกติ";
    return "อุณหภูมิสูงมาก";
  }

  return "-";
}

async function fetchSnapshot() {
  if (!BLYNK_TOKEN) throw new Error("ยังไม่ได้ตั้งค่า BLYNK_AUTH_TOKEN");

  const { pump, soil, water, temp, autoMode, alert } = CONFIG.pins;

  const [pumpRaw, soilRaw, waterRaw, tempRaw, autoModeRaw, alertRaw] = await Promise.all([
    getValue(pump),
    getValue(soil),
    getValue(water),
    getValue(temp),
    getValue(autoMode),
    getValue(alert)
  ]);

  const soilValue = parseNumber(soilRaw);
  const waterValue = parseNumber(waterRaw);
  const tempValue = parseNumber(tempRaw);
  const alertValue = computeAlertLabel(alertRaw);

  return {
    updatedAt: new Date().toISOString(),
    source: {
      platform: "Blynk",
      status: "ปกติ"
    },
    values: {
      pump: parseBooleanLike(pumpRaw),
      soil: soilValue,
      water: waterValue,
      temp: tempValue,
      autoMode: parseBooleanLike(autoModeRaw),
      alert: alertValue,
      descriptions: {
        soil: sensorText("soil", soilValue),
        water: sensorText("water", waterValue),
        temp: sensorText("temp", tempValue)
      }
    }
  };
}

function addHistory(type, message, extra = {}) {
  const items = readJson(HISTORY_FILE, []);
  items.unshift({
    id: `log_${Date.now()}`,
    type,
    time: new Date().toISOString(),
    message,
    ...extra
  });
  writeJson(HISTORY_FILE, items.slice(0, HISTORY_MAX_ITEMS));
}

async function collectHistorySnapshot() {
  try {
    const snap = await fetchSnapshot();
    addHistory("SYSTEM", "อัปเดตสถานะระบบ", { values: snap.values });
  } catch {}
}

function createResetToken(userId) {
  const tokens = readJson(RESET_TOKENS_FILE, []);
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000;

  const filtered = tokens.filter((t) => t.userId !== userId && t.expiresAt > Date.now());
  filtered.push({ token, userId, expiresAt });

  writeJson(RESET_TOKENS_FILE, filtered);
  return token;
}

function getResetTokenRecord(token) {
  const tokens = readJson(RESET_TOKENS_FILE, []);
  return tokens.find((t) => t.token === token && t.expiresAt > Date.now()) || null;
}

function removeResetToken(token) {
  const tokens = readJson(RESET_TOKENS_FILE, []);
  writeJson(
    RESET_TOKENS_FILE,
    tokens.filter((t) => t.token !== token)
  );
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
  const email = String(req.body?.email || "").trim().toLowerCase();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (!email || !username || !password) {
    return res.status(400).json({ success: false, error: "กรอกข้อมูลให้ครบ" });
  }

  if (!validateEmail(email)) {
    return res.status(400).json({ success: false, error: "รูปแบบอีเมลไม่ถูกต้อง" });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({ success: false, error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
  }

  const users = readJson(USERS_FILE, []);

  if (users.some((u) => u.email === email)) {
    return res.status(400).json({ success: false, error: "อีเมลนี้ถูกใช้แล้ว" });
  }

  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ success: false, error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว" });
  }

  const now = new Date().toISOString();
  const newUser = {
    id: `user_${Date.now()}`,
    email,
    username,
    password,
    createdAt: now,
    lastLoginAt: now,
    loginCount: 0
  };

  users.push(newUser);
  writeJson(USERS_FILE, users);
  addHistory("USER", "สมัครสมาชิกใหม่", { email, username });

  return res.json({ success: true, message: "สมัครสมาชิกสำเร็จ" });
});

app.post("/api/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();

  const user = findUserByEmail(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  }

  user.lastLoginAt = new Date().toISOString();
  user.loginCount = Number(user.loginCount || 0) + 1;
  updateUser(user);

  addHistory("USER", "เข้าสู่ระบบ", { email: user.email, username: user.username });

  return res.json({
    success: true,
    token: `token_${user.id}`,
    user: sanitizeUser(user)
  });
});

app.post("/api/forgot-password", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const user = findUserByEmail(email);

  if (!user) {
    return res.json({
      success: true,
      message: "หากอีเมลนี้มีอยู่ในระบบ เราได้สร้างลิงก์รีเซ็ตรหัสผ่านไว้แล้ว"
    });
  }

  const token = createResetToken(user.id);

  return res.json({
    success: true,
    message: "หากอีเมลนี้มีอยู่ในระบบ เราได้สร้างลิงก์รีเซ็ตรหัสผ่านไว้แล้ว",
    resetUrl: `/reset-password.html?token=${token}`
  });
});

app.get("/api/reset-password/:token", (req, res) => {
  const record = getResetTokenRecord(req.params.token);

  if (!record) {
    return res.status(400).json({ success: false, error: "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว" });
  }

  return res.json({ success: true });
});

app.post("/api/reset-password/:token", (req, res) => {
  const record = getResetTokenRecord(req.params.token);

  if (!record) {
    return res.status(400).json({ success: false, error: "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว" });
  }

  const newPassword = String(req.body?.newPassword || "").trim();
  const confirmPassword = String(req.body?.confirmPassword || "").trim();

  if (!newPassword || !confirmPassword) {
    return res.status(400).json({ success: false, error: "กรอกข้อมูลให้ครบ" });
  }

  if (!validatePassword(newPassword)) {
    return res.status(400).json({ success: false, error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, error: "รหัสผ่านไม่ตรงกัน" });
  }

  const user = findUserById(record.userId);

  if (!user) {
    return res.status(404).json({ success: false, error: "ไม่พบผู้ใช้งาน" });
  }

  user.password = newPassword;
  updateUser(user);
  removeResetToken(record.token);
  addHistory("USER", "รีเซ็ตรหัสผ่าน", { email: user.email, username: user.username });

  return res.json({ success: true, message: "รีเซ็ตรหัสผ่านสำเร็จ" });
});

app.get("/api/profile/:id", (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "ไม่พบผู้ใช้งาน" });
  }
  res.json({ success: true, user: sanitizeUser(user) });
});

app.put("/api/profile/:id", (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "ไม่พบผู้ใช้งาน" });
  }

  const username = String(req.body?.username || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const currentPassword = String(req.body?.currentPassword || "").trim();

  if (!username || !email || !currentPassword) {
    return res.status(400).json({ success: false, error: "กรอกข้อมูลให้ครบ" });
  }

  if (user.password !== currentPassword) {
    return res.status(400).json({ success: false, error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
  }

  if (!validateEmail(email)) {
    return res.status(400).json({ success: false, error: "รูปแบบอีเมลไม่ถูกต้อง" });
  }

  const users = readJson(USERS_FILE, []);
  const emailConflict = users.some((u) => u.id !== user.id && u.email === email);

  if (emailConflict) {
    return res.status(400).json({ success: false, error: "อีเมลนี้ถูกใช้แล้ว" });
  }

  user.username = username;
  user.email = email;
  updateUser(user);
  addHistory("USER", "แก้ไขข้อมูลบัญชี", { email: user.email, username: user.username });

  res.json({ success: true, user: sanitizeUser(user) });
});

app.put("/api/profile/:id/password", (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "ไม่พบผู้ใช้งาน" });
  }

  const currentPassword = String(req.body?.currentPassword || "").trim();
  const newPassword = String(req.body?.newPassword || "").trim();

  if (user.password !== currentPassword) {
    return res.status(400).json({ success: false, error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
  }

  if (!validatePassword(newPassword)) {
    return res.status(400).json({ success: false, error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
  }

  user.password = newPassword;
  updateUser(user);
  addHistory("USER", "เปลี่ยนรหัสผ่าน", { email: user.email, username: user.username });

  res.json({ success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" });
});

app.get("/api/status", async (req, res) => {
  try {
    const snap = await fetchSnapshot();
    res.json({ success: true, ...snap });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "ดึงข้อมูลสถานะไม่สำเร็จ" });
  }
});

app.get("/api/history", (req, res) => {
  const items = readJson(HISTORY_FILE, []);
  res.json({ success: true, items });
});

app.post("/api/toggle/pump", async (req, res) => {
  try {
    const nextValue = req.body?.value ? 1 : 0;

    if (nextValue) {
      const current = await fetchSnapshot();

      if (current.values.autoMode) {
        return res.status(400).json({ success: false, error: "ปิดโหมดอัตโนมัติก่อน จึงจะควบคุมปั๊มน้ำเองได้" });
      }

      if (current.values.alert === "น้ำใกล้หมด") {
        addHistory("ALERT", "ป้องกันการเปิดปั๊ม เพราะระดับน้ำต่ำ");
        return res.status(400).json({ success: false, error: "ระดับน้ำต่ำ ไม่สามารถเปิดปั๊มน้ำได้" });
      }
    }

    await setValue(CONFIG.pins.pump, nextValue);
    addHistory("PUMP", nextValue ? "เปิดปั๊มน้ำ" : "ปิดปั๊มน้ำ");

    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "อัปเดตปั๊มน้ำไม่สำเร็จ" });
  }
});

app.post("/api/toggle/auto-mode", async (req, res) => {
  try {
    const nextValue = req.body?.value ? 1 : 0;
    await setValue(CONFIG.pins.autoMode, nextValue);
    addHistory("AUTO", nextValue ? "เปิดโหมดอัตโนมัติ" : "ปิดโหมดอัตโนมัติ");
    res.json({ success: true, value: nextValue });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "อัปเดตโหมดอัตโนมัติไม่สำเร็จ" });
  }
});

ensureJsonFile(USERS_FILE, []);
ensureJsonFile(HISTORY_FILE, []);
ensureJsonFile(RESET_TOKENS_FILE, []);
collectHistorySnapshot();
setInterval(collectHistorySnapshot, HISTORY_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
