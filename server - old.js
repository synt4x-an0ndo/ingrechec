import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import crypto from "crypto";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: "uploads/" });
const OCR_API_KEY = "K88839716188957"; // OCR.space
const GEMINI_API_KEY = "AIzaSyBWn-yGf-v-Vi3uGf7qPJJqyxnN38VO2w8"; // Gemini AI
const USERS_FILE = path.join(__dirname, "users.json");
const HISTORY_FILE = path.join(__dirname, "history.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Enter your AES key (16 chars for AES-128): ", (AES_KEY) => {
  rl.close();

  if (!AES_KEY || AES_KEY.length !== 16) {
    console.log("AES key must be exactly 16 characters long!");
    process.exit(1);
  }

  // ---------- AES Encryption / Decryption ----------
  function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-128-cbc", AES_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  }

  function decrypt(data) {
    const [ivHex, encrypted] = data.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-128-cbc", AES_KEY, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // ---------- AES Key Validation ----------
  if (fs.existsSync(USERS_FILE)) {
    try {
      const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
      if (users.length > 0) decrypt(users[0].email);
    } catch (err) {
      console.log("❌ Incorrect AES key! Unable to decrypt users.json.");
      process.exit(1);
    }
  }

  console.log("✅ AES key loaded successfully!");

  // ---------- REGISTER ----------
  app.post("/register", (req, res) => {
    const { fullName, email, password, healthIssues, dob } = req.body;
    if (!fullName || !email || !password) return res.json({ success: false, message: "Missing fields" });

    let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) : [];
    if (users.some(u => decrypt(u.email) === email)) return res.json({ success: false, message: "Email already registered" });

    const encUser = {
      fullName: encrypt(fullName),
      email: encrypt(email),
      password: encrypt(password),
      healthIssues: (healthIssues || []).map(h => encrypt(h)),
      dob: dob ? encrypt(dob) : null
    };

    users.push(encUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true });
  });

  // ---------- LOGIN ----------
  app.post("/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ success: false, message: "Missing fields" });
    if (!fs.existsSync(USERS_FILE)) return res.json({ success: false, message: "No users found" });

    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    const user = users.find(u => decrypt(u.email) === email && decrypt(u.password) === password);
    if (!user) return res.json({ success: false, message: "Invalid credentials" });

    const decryptedUser = {
      fullName: decrypt(user.fullName),
      email: decrypt(user.email),
      healthIssues: user.healthIssues.map(h => decrypt(h)),
      dob: user.dob ? decrypt(user.dob) : null
    };

    res.json({ success: true, user: decryptedUser });
  });

  // ---------- UPDATE HEALTH ISSUES ----------
  app.post("/updateHealthIssues", (req, res) => {
    const { email, healthIssues } = req.body;
    if (!email || !Array.isArray(healthIssues)) return res.json({ success: false });

    if (!fs.existsSync(USERS_FILE)) return res.json({ success: false, message: "No users found" });
    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    const userIndex = users.findIndex(u => decrypt(u.email) === email);
    if (userIndex === -1) return res.json({ success: false });

    users[userIndex].healthIssues = healthIssues.map(h => encrypt(h));
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true });
  });

  // ---------- UPDATE DOB ----------
  app.post("/updateDOB", (req, res) => {
    const { email, dob } = req.body;
    if (!email) return res.json({ success: false, message: "Email required" });

    if (!fs.existsSync(USERS_FILE)) return res.json({ success: false, message: "No users found" });
    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    const userIndex = users.findIndex(u => decrypt(u.email) === email);
    if (userIndex === -1) return res.json({ success: false, message: "User not found" });

    users[userIndex].dob = dob ? encrypt(dob) : null;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true });
  });

  // ---------- CALCULATE AGE FROM DOB ----------
  function calculateAge(dob) {
    if (!dob) return null;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  // ---------- OCR ----------
  app.post("/ocr", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.json({ extracted_text: "❌ No file uploaded" });

      const fileData = fs.readFileSync(req.file.path);
      const base64Image = "data:image/png;base64," + fileData.toString("base64");

      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { "apikey": OCR_API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ base64Image, language: "eng", isOverlayRequired: "false" })
      });

      const result = await response.json();
      let text = "⚠️ No text detected";
      if (result?.ParsedResults?.length > 0) text = result.ParsedResults[0].ParsedText?.trim() || text;
      else if (result?.ErrorMessage) text = "❌ API Error: " + result.ErrorMessage;

      // Save to history.json
      if (req.body.email && text && text !== "⚠️ No text detected") {
        const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
        history.push({
          email: encrypt(req.body.email),
          text: encrypt(text),
          timestamp: new Date().toISOString()
        });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      }

      res.json({ extracted_text: text });
    } catch (e) {
      res.json({ extracted_text: "❌ OCR failed: " + e.message });
    } finally {
      if (req.file) fs.unlinkSync(req.file.path);
    }
  });

  // ---------- HISTORY ----------
  app.get("/history", (req, res) => {
    const emailQuery = req.query.email;
    if (!emailQuery) return res.json({ history: [] });

    const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
    const userHistory = history
      .filter(h => decrypt(h.email) === emailQuery)
      .map(h => ({ text: decrypt(h.text), timestamp: h.timestamp }));

    res.json({ history: userHistory });
  });



  app.delete("/history", (req, res) => {
    const { email, index } = req.body;
    if (!email || index == null) return res.json({ success: false });

    let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
    const userIndices = history.map((h,i)=> decrypt(h.email) === email ? i : -1).filter(i=>i!==-1);
    if (index < 0 || index >= userIndices.length) return res.json({ success: false });

    const delIndex = userIndices[index];
    history.splice(delIndex, 1);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    res.json({ success: true });
  });

  // ---------- AI ANALYZE (Gemini) ----------
  app.post("/analyze", async (req, res) => {
    const { text, healthIssues, dob } = req.body;
    if (!text) return res.json({ success: false, analysis: "No text provided" });

    try {
      // Calculate age from DOB
      const age = dob ? calculateAge(dob) : null;
      const ageInfo = age ? `Age: ${age} years` : "Age: Not specified";
      
      const prompt = `You are a professional health assistant for a food-ingredients analysis website.
Health Issues: ${healthIssues && healthIssues.length ? healthIssues.join(", ") : "None"}
${ageInfo}
Ingredients: ${text}
When responding, follow these rules (clear, balanced, user-friendly, detailed):

Rules:
1. Only evaluate processed, artificial, or prepared foods (e.g., packaged snacks, beverages, sauces, homemade curries).  
2. Do NOT evaluate natural foods (fruits, vegetables, eggs, grains, meat, spices), *except vitamins and minerals*—these are always eligible.  
3. If the input is natural (excluding vitamins/minerals), in Bangla, or not a food ingredient, respond:  
   "Currently Not Available in our system. We are still working on it, This will be added in future updates. Stay with us. -Admin"  
   *➤ Update:* If the input is a natural food (like milk, egg, banana, guava), then check its key *vitamins & minerals* and provide full analysis based on them.  
4. For eligible items, provide a clear, balanced, detailed analysis including:  
   - Positive & negative aspects  
   - Suitability by health issues & age  
   - Portion & frequency guidance  
   - Safer alternatives  
   - Quality/adulteration check  
   *➤ Update:* For natural foods, analysis should focus on their vitamin & mineral content (benefits, risks, age suitability, intake guidance).  
5. End with a conclusion:  
   - Verdict (Good / Moderate / Not Recommended)  
   - User-Friendly Flag (Possible / Conditional / Not Advisable)  
   - Final Recommendation  
   - Confidence Level.`;

      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );

      const aiData = await aiResponse.json();
      const analysis = aiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "⚠️ No analysis returned";

      res.json({ success: true, analysis });
    } catch (err) {
      console.error(err);
      res.json({ success: false, analysis: "❌ AI analysis failed." });
    }
  });

  // ---------- Default Route ----------
  app.get("/", (req, res) => {
    const indexPath = path.join(__dirname, "public", "index.html");
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).send("Not Found");
  });

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

  // ---------- Start Server ----------
  const PORT = 3000;
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
});

const user = JSON.parse(localStorage.getItem("user")||"{}");
  document.getElementById("userName").textContent = user.fullName||"N/A";
  document.getElementById("userEmail").textContent = user.email||"N/A";
  document.getElementById("userId").textContent = user.userId || "N/A";
  document.getElementById("userIssuesInput").value = user.healthIssues ? user.healthIssues.join(", ") : "";
  document.getElementById("welcomeName").textContent = `Welcome, ${user.fullName||"User"}!`;
  if(user.dob){
    document.getElementById("userDOB").value = user.dob;
    calculateAge();
  }