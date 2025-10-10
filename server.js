import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import fg from "fast-glob";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config();

// ---------- MongoDB Connection ----------
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection failed:", err));

// ---------- MongoDB Schemas ----------
const userSchema = new mongoose.Schema(
  {
    userId: Number,
    fullName: String,
    emailHash: String,
    passwordHash: String,
    healthIssues: [String],
    dob: String,
  },
  { timestamps: true }
);

const historySchema = new mongoose.Schema(
  {
    userId: Number,
    input: String,
    ocr: String,
    response: String,
    timestamp: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const History = mongoose.model("History", historySchema);

// ---------- Setup ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: "uploads/" });

const OCR_API_KEY = process.env.OCR_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AES_KEY = process.env.AES_KEY; // ✅ Now using .env

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ✅ Validate AES key from .env
if (!AES_KEY || AES_KEY.length !== 16) {
  console.log("AES key must be exactly 16 characters long! Set AES_KEY in your .env file.");
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

// ---------- SHA3-512 Hash ----------
function sha3(data) {
  return crypto.createHash("sha3-512").update(data).digest("hex");
}

console.log("✅ AES key loaded successfully from .env!");

// ---------- REGISTER ----------
app.post("/register", async (req, res) => {
  const { fullName, email, password, healthIssues, dob } = req.body;
  if (!fullName || !email || !password)
    return res.json({ success: false, message: "Missing fields" });

  const emailHash = sha3(email);
  const passwordHash = sha3(password);
  const existingUser = await User.findOne({ emailHash });
  if (existingUser)
    return res.json({ success: false, message: "Email already registered" });

  const lastUser = await User.findOne().sort({ userId: -1 });
  const userId = lastUser ? lastUser.userId + 1 : 1;

  const encUser = new User({
    userId,
    fullName: encrypt(fullName),
    emailHash,
    passwordHash,
    healthIssues: (healthIssues || []).map((h) => encrypt(h)),
    dob: dob ? encrypt(dob) : null,
  });

  await encUser.save();
  res.json({ success: true, userId });
});

// ---------- LOGIN ----------
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.json({ success: false, message: "Missing fields" });

  const emailHash = sha3(email);
  const passwordHash = sha3(password);

  const user = await User.findOne({ emailHash, passwordHash });
  if (!user) return res.json({ success: false, message: "Invalid credentials" });

  const decryptedUser = {
    userId: user.userId,
    fullName: decrypt(user.fullName),
    email,
    healthIssues: user.healthIssues.map((h) => decrypt(h)),
    dob: user.dob ? decrypt(user.dob) : null,
  };

  res.json({ success: true, user: decryptedUser });
});

// ---------- UPDATE HEALTH ISSUES ----------
app.post("/updateHealthIssues", async (req, res) => {
  const { userId, healthIssues } = req.body;
  if (!userId || !Array.isArray(healthIssues))
    return res.json({ success: false, message: "Missing fields" });

  const user = await User.findOne({ userId });
  if (!user) return res.json({ success: false, message: "User not found" });

  user.healthIssues = healthIssues.map((h) => encrypt(h));
  await user.save();

  res.json({ success: true });
});

// ---------- UPDATE DOB ----------
app.post("/updateDOB", async (req, res) => {
  const { userId, dob } = req.body;
  if (!userId) return res.json({ success: false, message: "User ID required" });

  const user = await User.findOne({ userId });
  if (!user) return res.json({ success: false, message: "User not found" });

  user.dob = dob ? encrypt(dob) : null;
  await user.save();

  res.json({ success: true });
});

// ---------- CALCULATE AGE ----------
function calculateAge(dob) {
  if (!dob) return null;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate()))
    age--;
  return age;
}

// ---------- OCR ----------
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.json({ extracted_text: "❌ No file uploaded" });

    const fileData = fs.readFileSync(req.file.path);
    const base64Image = fileData.toString("base64");

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        OCR_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: "You are an ocr model. Extract all text from this image accurately. If no text, say 'No text detected, Upload an image with ingredients list. -Admin'. Output only extracted text.",
                },
                {
                  inline_data: { mime_type: "image/png", data: base64Image },
                },
              ],
            },
          ],
        }),
      }
    );

    const result = await response.json();
    let text = "⚠️ No text detected";
    if (result?.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = result.candidates[0].content.parts[0].text.trim();
    } else if (result?.error?.message) {
      text = "❌ API Error: " + result.error.message;
    }

    if (req.body.userId && text && text !== "⚠️ No text detected") {
      await History.create({
        userId: req.body.userId,
        ocr: encrypt(text),
        input: "",
        response: "",
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ extracted_text: text });
  } catch (e) {
    res.json({ extracted_text: "❌ OCR failed: " + e.message });
  } finally {
    if (req.file) fs.unlinkSync(req.file.path);
  }
});

// ---------- HISTORY ----------
app.get("/history", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ history: [] });

  const history = await History.find({ userId });
  const userHistory = history.map((h) => ({
    input: h.input ? decrypt(h.input) : "",
    ocr: h.ocr ? decrypt(h.ocr) : "",
    response: h.response ? decrypt(h.response) : "",
    timestamp: h.timestamp,
  }));

  res.json({ history: userHistory });
});

app.delete("/history", async (req, res) => {
  const { userId, index } = req.body;
  if (!userId || index == null) return res.json({ success: false });

  const userHistory = await History.find({ userId }).sort({ createdAt: 1 });
  if (index < 0 || index >= userHistory.length)
    return res.json({ success: false });

  await History.deleteOne({ _id: userHistory[index]._id });
  res.json({ success: true });
});

// ---------- AI ANALYZE ----------
app.post("/analyze", async (req, res) => {
  const { text, healthIssues, dob, userId } = req.body;

  if (!text) return res.json({ success: false, analysis: "No text provided" });

  try {
    const age = dob ? calculateAge(dob) : null;
    const ageInfo = age ? `Age: ${age} years` : "Age: Not specified";

    const prompt = `
You are the best food checker and a professional health assistant for a food-ingredients analysis website.  
Also, act as an AI that responds intelligently — thoughtfully and carefully — so that its answers are about 95% accurate every time.

Health Issues: ${healthIssues && healthIssues.length ? healthIssues.join(", ") : "None"}

${ageInfo}

Ingredients: ${text}

When responding, follow these rules (clear, balanced, user-friendly, detailed):

Rules: Start The response from Ingredients no need of upper texts

1. Only evaluate processed, artificial, or prepared foods (e.g., packaged snacks, beverages, sauces, homemade curries).

2. Do NOT evaluate natural foods (fruits, vegetables, eggs, grains, meat, spices), except vitamins and minerals — these are always eligible.

3. If the input is natural (excluding vitamins/minerals), in Bangla, or not a food ingredient, respond:

"Currently Not Available in our system. We are still working on it, This will be added in future updates. Stay with us. -Admin"

➤ Update: If the input is a natural food (like milk, egg, banana, guava), then check its key vitamins & minerals and provide full analysis based on them.

4. For eligible items, provide a clear, balanced, detailed analysis including:

   • Positive aspects (format with <span style="color:green">text</span>)  
   • Negative aspects (format with <span style="color:red">text</span>)  
   • Positive & negative aspects  
   • Suitability by health issues & age  
   • Portion & frequency guidance  
   • Safer alternatives  
   • Quality/adulteration check  

➤ Update: For natural foods, analysis should focus on their vitamin & mineral content (benefits, risks, age suitability, intake guidance).

5. End with a conclusion:

   • Verdict (Good / Moderate / Not Recommended)  
   • User-Friendly Flag (Possible / Conditional / Not Advisable)  
   • Final Recommendation  
   • Confidence Level.

6. Only color the points name.
`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    const aiData = await aiResponse.json();
    const analysis =
      aiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "⚠️ No analysis returned";

    if (userId && text && analysis) {
      await History.create({
        userId,
        ocr: "",
        input: encrypt(text),
        response: encrypt(analysis),
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ success: true, analysis });
  } catch (err) {
    console.error(err);
    res.json({ success: false, analysis: "❌ AI analysis failed." });
  }
});

// ---------- Dynamic Sitemap ----------
app.get("/sitemap.xml", async (req, res) => {
  try {
    // Scan all HTML pages (root + ingredients folder)
    const fg = (await import("fast-glob")).default; // dynamic import
    const files = await fg(["./public/*.html"]);

    const BASE_URL = "https://www.ingrechec.online";

    const urls = files.map(file => {
      const relativePath = file.replace(/^\.\/public|\\/g, "/");
      return `
  <url>
    <loc>${BASE_URL}${relativePath.startsWith("/") ? "" : "/"}${relativePath}</loc>
    <priority>${relativePath === "/index.html" ? "1.0" : "0.8"}</priority>
    <changefreq>${relativePath === "/index.html" ? "daily" : "weekly"}</changefreq>
  </url>`;
    }).join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (err) {
    console.error("Error generating sitemap:", err);
    res.status(500).send("Sitemap generation failed");
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
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`)
);
