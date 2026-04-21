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
  if (!confirm("ต้องการออกจากระบบใช่หรือไม่")) return;
  clearStoredUser();
  window.location.href = "/login.html";
}

async function loadConfig(titleId = "deviceName") {
  const data = await fetchJson("/api/config");
  const el = document.getElementById(titleId);
  if (el) el.textContent = data.config.deviceName || "ระบบควบคุมรดน้ำอัจฉริยะ";
  return data.config;
}

function showToast(message, type = "info") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function setFieldError(inputId, message) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(`${inputId}Error`);
  if (input) input.classList.add("input-error");
  if (error) error.textContent = message || "";
}

function clearFieldError(inputId) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(`${inputId}Error`);
  if (input) input.classList.remove("input-error");
  if (error) error.textContent = "";
}

function clearFieldErrors(ids) {
  ids.forEach(clearFieldError);
}

function setupPasswordToggle(buttonId, inputId) {
  const button = document.getElementById(buttonId);
  const input = document.getElementById(inputId);
  if (!button || !input) return;

  button.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    button.textContent = isPassword ? "ซ่อน" : "แสดง";
  });
}

function setButtonLoading(button, isLoading, loadingText, normalText) {
  if (!button) return;
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = normalText || button.textContent;
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.textContent = normalText || button.dataset.originalText || button.textContent;
  }
}

function sensorTone(type, value) {
  if (type === "soil") {
    if (value <= 300) return "danger";
    if (value <= 1200) return "warning";
    return "success";
  }

  if (type === "water") {
    if (value <= 300) return "danger";
    if (value <= 1200) return "warning";
    return "success";
  }

  if (type === "temp") {
    if (value > 38) return "danger";
    if (value > 32) return "warning";
    return "success";
  }

  return "neutral";
}
