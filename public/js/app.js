function getStoredUser() {
  const raw = localStorage.getItem("app_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setStoredUser(user) {
  localStorage.setItem("app_user", JSON.stringify(user));
}

function clearStoredUser() {
  localStorage.removeItem("app_user");
  localStorage.removeItem("app_token");
}

function getStoredToken() {
  return localStorage.getItem("app_token") || "";
}

function setStoredToken(token) {
  localStorage.setItem("app_token", token);
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH");
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "เกิดข้อผิดพลาด");
  return data;
}

function redirectIfNotLoggedIn() {
  const user = getStoredUser();
  const token = getStoredToken();
  if (!user || !token) {
    window.location.href = "/login.html";
  }
}

function renderTopUser(elId = "currentUser") {
  const user = getStoredUser();
  const el = document.getElementById(elId);
  if (el) el.textContent = user?.username || "-";
}

function logout() {
  clearStoredUser();
  window.location.href = "/login.html";
}

async function loadConfig(titleId = "deviceName") {
  const data = await fetchJson("/api/config");
  const el = document.getElementById(titleId);
  if (el) el.textContent = data.config.deviceName || "ระบบควบคุมรดน้ำอัจฉริยะ";
  return data.config;
}
