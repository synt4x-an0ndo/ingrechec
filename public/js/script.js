// ---------- Theme Management ----------
let currentTheme = localStorage.getItem('theme') || 'system';

function updateThemeIcon() {
  const resolvedTheme = getResolvedTheme();
  const icon = resolvedTheme === 'dark' ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
  const systemIcon = currentTheme === 'system' ? '<i class="fas fa-desktop"></i>' : icon;
  document.getElementById('theme-icon').innerHTML = systemIcon;
}

function getResolvedTheme() {
  if (currentTheme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return currentTheme;
}

function applyTheme() {
  const resolvedTheme = getResolvedTheme();
  if (resolvedTheme === 'dark') document.body.classList.add('dark');
  else document.body.classList.remove('dark');
  updateThemeIcon();
}

function setTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('theme', theme);
  applyTheme();
  toggleThemeMenu();
}

function toggleThemeMenu() {
  const menu = document.getElementById('theme-menu');
  menu.classList.toggle('show');
}

function handleOutsideClick(event) {
  const themeMenu = document.getElementById('theme-menu');
  if (!event.target.closest('.theme-dropdown')) themeMenu.classList.remove('show');
}

// ---------- Scroll Animations ----------
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('animate-in');
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
  document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
}

// ---------- User Management ----------
function getUser() {
  return JSON.parse(localStorage.getItem("user") || "{}");
}

function updateUserInfo() {
  const user = getUser();
  if (document.getElementById("userName")) {
    document.getElementById("userName").textContent = user.fullName || "N/A";
  }
  if (document.getElementById("userEmail")) {
    document.getElementById("userEmail").textContent = user.email || "N/A";
  }
  if (document.getElementById("userId")) {
    document.getElementById("userId").textContent = user.userId || "N/A";
  }
  if (document.getElementById("userIssuesInput")) {
    document.getElementById("userIssuesInput").value = user.healthIssues ? user.healthIssues.join(", ") : "";
  }
  if (document.getElementById("welcomeName")) {
    document.getElementById("welcomeName").textContent = `Welcome, ${user.fullName || "User"}!`;
  }
  if (document.getElementById("userDOB") && user.dob) {
    document.getElementById("userDOB").value = user.dob;
    calculateAge();
  }
}

// ---------- Health Issues ----------
async function saveHealthIssues() {
  const user = getUser();
  const issuesInput = document.getElementById("userIssuesInput").value.trim();
  const issuesArray = issuesInput ? issuesInput.split(",").map(i => i.trim()) : [];
  try {
    const res = await fetch("/updateHealthIssues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.userId, healthIssues: issuesArray })
    });
    const data = await res.json();
    if (data.success) {
      user.healthIssues = issuesArray;
      localStorage.setItem("user", JSON.stringify(user));
      alert("✅ Health issues updated successfully!");
    } else alert("❌ Failed to update health issues.");
  } catch (err) { alert("❌ Server error."); }
}

// ---------- DOB & Age ----------
function calculateAge() {
  const dob = document.getElementById("userDOB").value;
  if (!dob) { 
    if (document.getElementById("calculatedAge")) {
      document.getElementById("calculatedAge").textContent = "Age: N/A"; 
    }
    return; 
  }
  const birthDate = new Date(dob);
  const diff = Date.now() - birthDate.getTime();
  const ageDate = new Date(diff);
  const age = Math.abs(ageDate.getUTCFullYear() - 1970);
  if (document.getElementById("calculatedAge")) {
    document.getElementById("calculatedAge").textContent = `Age: ${age}`;
  }
}

async function saveDOB() {
  const user = getUser();
  const dob = document.getElementById("userDOB").value;
  if (!dob) return alert("Please select your date of birth!");
  try {
    const res = await fetch("/updateDOB", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.userId, dob })
    });
    const data = await res.json();
    if (data.success) {
      user.dob = dob;
      localStorage.setItem("user", JSON.stringify(user));
      calculateAge();
      alert("✅ Date of birth updated successfully!");
    } else alert("❌ Failed to update DOB.");
  } catch (err) { alert("❌ Server error."); }
}

// ---------- File Upload / OCR ----------
function initFileUpload() {
  const dropArea = document.getElementById("dropArea");
  const fileInput = document.getElementById("fileInput");
  const previewImage = document.getElementById("previewImage");
  const previewContainer = document.getElementById("previewContainer");

  if (dropArea && fileInput) {
    dropArea.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
    dropArea.addEventListener("dragover", e => { e.preventDefault(); dropArea.style.background = "rgba(22,163,74,0.1)"; });
    dropArea.addEventListener("dragleave", () => dropArea.style.background = "rgba(22,163,74,0.03)");
    dropArea.addEventListener("drop", e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleFile(file); });
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = e => { 
      if (previewImage) previewImage.src = e.target.result; 
      if (previewContainer) previewContainer.classList.add("show"); 
    };
    reader.readAsDataURL(file);
  }
}

async function uploadImage() {
  const user = getUser();
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  if (!file) return alert("Please upload an image first!");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("userId", user.userId);
  document.getElementById("ocrResult").value = "⏳ Processing...";
  try {
    const res = await fetch("/ocr", { method: "POST", body: formData });
    const data = await res.json();
    document.getElementById("ocrResult").value = data.extracted_text;
    document.getElementById("aiOutput").textContent = "AI analysis will appear here...";
  } catch (err) { document.getElementById("ocrResult").value = "❌ OCR failed."; }
}

// ---------- AI Analysis ----------
async function analyzeText() {
  const user = getUser();
  const text = document.getElementById("ocrResult").value;
  if (!text.trim()) return alert("No text to analyze!");
  const aiOutput = document.getElementById("aiOutput");
  aiOutput.textContent = "⏳ AI analyzing...";
  try {
    const res = await fetch("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.userId, text, healthIssues: user.healthIssues || [], dob: user.dob || null })
    });
    const data = await res.json();
    if (data.success) aiOutput.innerHTML = marked.parse(data.analysis);
    else aiOutput.textContent = "❌ AI analysis failed.";
  } catch (err) { aiOutput.textContent = "❌ AI analysis failed."; }
}

// ---------- History ----------
async function loadHistory() {
  const user = getUser();
  const list = document.getElementById("historyList");
  if (!list) return;
  
  list.innerHTML = "Loading...";
  try {
    const res = await fetch("/history?userId=" + encodeURIComponent(user.userId));
    const data = await res.json();
    if (!data.history || data.history.length === 0) list.innerHTML = "<li>No scans yet.</li>";
    else {
      list.innerHTML = "";
      data.history.forEach((h, i) => {
        const li = document.createElement("li");
        li.className = "history-item";
        li.innerHTML = `<span>${h.text}</span><button onclick="deleteHistory(${i})">Delete</button>`;
        list.appendChild(li);
      });
    }
  } catch (err) { list.innerHTML = "<li>Error loading history.</li>"; }
}

async function deleteHistory(index) {
  const user = getUser();
  if (!confirm("Delete this history?")) return;
  try {
    const res = await fetch("/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.userId, index })
    });
    const data = await res.json();
    if (data.success) loadHistory();
    else alert("❌ Failed to delete history.");
  } catch (err) { alert("❌ Server error."); }
}

// ---------- Navigation ----------
function navigateTo(page) {
  window.location.href = page;
}

function setActiveNav(currentPage) {
  const navButtons = document.querySelectorAll('.menu button');
  navButtons.forEach(button => {
    button.classList.remove('active');
    if (button.getAttribute('data-page') === currentPage) {
      button.classList.add('active');
    }
  });
}

// ---------- Logout ----------
function logout() {
  localStorage.removeItem("loggedIn");
  localStorage.removeItem("user");
  window.location.href = "signin.html";
}

// ---------- Initialization ----------
function initPage() {
  // Check authentication
  if (!localStorage.getItem("loggedIn") && !window.location.href.includes('signin.html')) {
    window.location.href = "signin.html";
    return;
  }

  applyTheme();
  initScrollAnimations();
  updateUserInfo();
  initFileUpload();
  
  document.addEventListener('click', handleOutsideClick);
  window.matchMedia('(prefers-color-scheme: dark)')?.addEventListener('change', () => {
    if (currentTheme === 'system') applyTheme();
  });

  // Auto-load history if on history page
  if (window.location.href.includes('history.html')) {
    loadHistory();
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initPage);