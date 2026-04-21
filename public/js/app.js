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

function isLoggedIn() {
  return !!(getStoredUser() && getStoredToken());
}

function redirectIfNotLoggedIn() {
  if (!isLoggedIn()) {
    window.location.href = "/login.html";
  }
}

function redirectIfLoggedIn() {
  if (isLoggedIn()) {
    window.location.href = "/dashboard.html";
  }
}

function renderTopUser(elId = "currentUser") {
  const user = getStoredUser();
  const el = document.getElementById(elId);
  if (el) el.textContent = user?.username || "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH");
}

function formatNumberOrDash(value) {
  return value === null || value === undefined ? "-" : Number(value).toLocaleString();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "เกิดข้อผิดพลาด");
  return data;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
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

function setFieldError(inputId, message) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(`${inputId}Error`);
  if (input) input.classList.add("input-error");
  if (error) error.textContent = message || "";
}

function setupPasswordToggle(buttonId, inputId) {
  const button = document.getElementById(buttonId);
  const input = document.getElementById(inputId);
  if (!button || !input) return;

  button.setAttribute("aria-label", "สลับการแสดงรหัสผ่าน");

  button.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    button.classList.toggle("is-visible", isPassword);
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

function showConfirm(message, title = "ยืนยันการทำรายการ") {
  return new Promise((resolve) => {
    let overlay = document.getElementById("confirmOverlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "confirmOverlay";
      overlay.className = "confirm-overlay";
      overlay.innerHTML = `
        <div class="confirm-modal">
          <button id="confirmClose" class="confirm-close" type="button" aria-label="ปิด">×</button>
          <div class="confirm-title" id="confirmTitle"></div>
          <div class="confirm-message" id="confirmMessage"></div>
          <div class="confirm-actions">
            <button id="confirmCancel" class="btn btn-light" type="button">ยกเลิก</button>
            <button id="confirmOk" class="btn btn-primary" type="button">ยืนยัน</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    overlay.querySelector("#confirmTitle").textContent = title;
    overlay.querySelector("#confirmMessage").textContent = message;
    overlay.classList.add("show");

    const okButton = overlay.querySelector("#confirmOk");
    const cancelButton = overlay.querySelector("#confirmCancel");
    const closeButton = overlay.querySelector("#confirmClose");

    function cleanup(result) {
      overlay.classList.remove("show");
      okButton.onclick = null;
      cancelButton.onclick = null;
      closeButton.onclick = null;
      overlay.onclick = null;
      resolve(result);
    }

    okButton.onclick = () => cleanup(true);
    cancelButton.onclick = () => cleanup(false);
    closeButton.onclick = () => cleanup(false);
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup(false);
    };
  });
}

function logout() {
  showConfirm("ต้องการออกจากระบบใช่หรือไม่", "ออกจากระบบ").then((ok) => {
    if (!ok) return;
    clearStoredUser();
    showToast("ออกจากระบบแล้ว", "info");
    setTimeout(() => {
      window.location.href = "/login.html";
    }, 300);
  });
}

async function loadConfig(titleId = "deviceName") {
  const data = await fetchJson("/api/config");
  const el = document.getElementById(titleId);
  if (el) el.textContent = data.config.deviceName || "ระบบควบคุมรดน้ำอัจฉริยะ";
  return data.config;
}

function toneClassFromText(text) {
  const value = String(text || "").toLowerCase();
  if (
    value.includes("ต่ำ") ||
    value.includes("สูงมาก") ||
    value.includes("ใกล้หมด") ||
    value.includes("ไม่มีข้อมูล")
  ) {
    return "tone-danger";
  }
  if (
    value.includes("ค่อนข้าง") ||
    value.includes("สูงกว่าปกติ") ||
    value.includes("เหลือน้อย")
  ) {
    return "tone-warning";
  }
  if (
    value.includes("ปกติ") ||
    value.includes("ดี") ||
    value.includes("ชื้น")
  ) {
    return "tone-success";
  }
  return "tone-neutral";
}
