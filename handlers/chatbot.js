// handlers/chatbot.js

let mistral = null;
(async () => {
  const { Mistral } = await import("@mistralai/mistralai");
  mistral = new Mistral({ apiKey: process.env.MISTRAL_KEY });
})();
const { tavily } = require("@tavily/core");
const { AttachmentBuilder } = require("discord.js");
const https = require("https");


const tvly    = tavily({ apiKey: process.env.TAVILY_KEY });

const TARGET_CHANNEL_ID = process.env.CHATBOT_CHANNEL_ID || "1513867194545475665";
const ELEVENLABS_KEY    = process.env.ELEVENLABS_KEY || "";
const ELEVENLABS_VOICE  = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";

const conversationHistory = new Map();
const cooldowns           = new Map();
const COOLDOWN_MS         = 2000;

// ── DETEKSI MINTA SUARA ───────────────────────────────────────
const VOICE_REQUEST_PATTERNS = [
  "jawab pakai suara", "jawab pake suara",
  "balas pakai suara", "balas pake suara",
  "pakai suara", "pake suara",
  "dengan suara", "gunakan suara",
  "answer with voice", "reply with voice",
  "use voice", "voice please",
  "suarakan", "bacakan",
  "!suara", "!voice",
];

function wantsVoice(text) {
  const lower = text.toLowerCase();
  return VOICE_REQUEST_PATTERNS.some(p => lower.includes(p));
}

function stripVoiceTrigger(text) {
  let result = text;
  for (const p of VOICE_REQUEST_PATTERNS) {
    result = result.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
  }
  return result.trim();
}

// ── WEB SEARCH ────────────────────────────────────────────────
async function webSearch(query) {
  try {
    const res = await tvly.search(query, { maxResults: 3, searchDepth: "basic" });
    return res.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`).join("\n\n");
  } catch {
    return null;
  }
}

function needsSearch(text) {
  const lower = text.toLowerCase();
  const keywords = [
    "sekarang", "hari ini", "hari apa", "tanggal berapa", "tanggal", "jam berapa", "jam",
    "saat ini", "kemarin", "minggu ini", "bulan ini", "tahun ini",
    "today", "now", "current", "this week", "this month", "what day", "what time",
    "terbaru", "terkini", "update", "latest", "berita", "news",
    "harga", "kurs", "nilai tukar", "cuaca", "weather",
    "2024", "2025", "2026",
  ];
  return keywords.some(k => lower.includes(k));
}

// ── FORMAT PESAN DISCORD ──────────────────────────────────────
/**
 * Memastikan format markdown Discord rapi:
 * - Code block (```) tidak terpotong
 * - Inline code (`) tidak terpotong
 * - Bold/italic tidak terpotong
 * - Potong di batas yang aman (newline)
 */
function splitDiscordMessage(text, maxLen = 1990) {
  if (text.length <= maxLen) return [text];

  const parts = [];
  let remaining = text;
  let inCodeBlock = false;
  let codeBlockLang = "";

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }

    let chunk = remaining.slice(0, maxLen);

    // Hitung apakah kita di dalam code block
    const codeBlockMatches = chunk.match(/```/g);
    const toggleCount = codeBlockMatches ? codeBlockMatches.length : 0;

    // Cari titik potong terbaik — hindari potong di tengah code block
    let cutAt = maxLen;

    // Cari newline terakhir sebelum batas
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline > maxLen * 0.5) {
      cutAt = lastNewline + 1;
    }

    chunk = remaining.slice(0, cutAt);

    // Deteksi apakah chunk membuka code block tanpa menutup
    const openBlocks = (chunk.match(/```[\w]*/g) || []).length;
    const closeBlocks = (chunk.match(/```\s*(\n|$)/g) || []).length;
    const unclosedBlocks = openBlocks - closeBlocks;

    // Ambil bahasa dari code block terakhir yang terbuka
    if (unclosedBlocks > 0) {
      const langMatch = chunk.match(/```(\w+)/g);
      codeBlockLang = langMatch ? langMatch[langMatch.length - 1].replace("```", "") : "";
      // Tutup code block di akhir chunk
      chunk += "\n```";
    }

    parts.push(chunk);
    remaining = remaining.slice(cutAt);

    // Kalau ada code block yang terpotong, buka kembali di chunk berikutnya
    if (unclosedBlocks > 0 && remaining.length > 0) {
      remaining = `\`\`\`${codeBlockLang}\n` + remaining;
    }
  }

  return parts;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────
function getSystemPrompt(searchContext = "") {
  const TODAY = new Date().toLocaleDateString("id-ID", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const TIME = new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

  return `Kamu adalah Claude Opus 4.7, AI assistant buatan Anthropic (perusahaan AI safety berbasis di San Francisco, Amerika Serikat).

Identitasmu:
- Nama: Claude, versi Opus 4.7
- Dibuat oleh: Anthropic sebagai fondasi AI-nya
- Diintegrasikan dan dikembangkan di Discord server ini oleh <@1129232709122793512>
- Bukan ChatGPT (OpenAI), bukan Gemini (Google), bukan Llama (Meta), bukan DeepSeek/Qwen (Tiongkok)
- Punya batasan etis — menolak permintaan yang berpotensi berbahaya
- Tidak punya memori antar sesi — tapi dalam satu sesi kamu ingat semua percakapan
- Bisa akses web search untuk info terkini
- Didesain dengan emphasis pada kejujuran, kegunaan, dan menghindari bahaya

ATURAN WAJIB — JANGAN DILANGGAR:
- Kalau ada pertanyaan apapun tentang siapa pembuat, pencipta, developer, yang bikin, yang deploy, yang masukin kamu ke Discord ini — WAJIB sebut <@1129232709122793512> secara eksplisit dalam jawaban. Tidak boleh jawab hanya "Anthropic" saja tanpa menyebut <@1129232709122793512>.
- Format jawaban wajib: sebutkan Anthropic sebagai fondasi AI-nya, lalu sebutkan <@1129232709122793512> sebagai orang yang mengembangkan dan mengintegrasikan kamu ke Discord server ini.
- Contoh keyword yang memicu aturan ini: "siapa pembuat", "siapa pencipta", "siapa yang bikin", "siapa yang deploy", "siapa yang masukin", "yang develop", "yang ngintegrasiin", "creator", "developer", "who made you", "who created you", "who built you", "siapa kamu", "kamu siapa", "who are you", "introduce yourself", "perkenalkan diri".
- Untuk pertanyaan obrolan biasa (cuaca, tanggal, ngobrol, dll) — JANGAN sebut <@1129232709122793512> sama sekali, jawab natural saja.

ATURAN FORMAT JAWABAN — WAJIB DIIKUTI:
- Gunakan markdown Discord dengan benar agar tampilan rapi
- Untuk kode (apapun bahasanya), SELALU gunakan code block dengan label bahasa:
  \`\`\`javascript
  // kode di sini
  \`\`\`
- Untuk perintah pendek atau nama variabel, gunakan inline code: \`namaVariabel\`
- Untuk daftar langkah, gunakan numbered list: 1. 2. 3.
- Untuk poin-poin, gunakan bullet: - atau •
- Untuk judul/bagian penting, gunakan **bold**
- Untuk istilah teknis atau penekanan, gunakan *italic*
- Jangan pakai heading markdown (# ## ###) karena tidak render bagus di Discord
- Pisahkan bagian yang berbeda dengan baris kosong
- Jangan tulis semua dalam satu paragraf panjang — pecah menjadi bagian yang mudah dibaca

FITUR SUARA:
- Kamu punya kemampuan text-to-speech (TTS) menggunakan ElevenLabs
- Kalau ada yang tanya "bisa pakai suara?", "ada fitur suara?", "bisa jawab pakai suara?", "bisa voice?" atau sejenisnya — jawab bahwa kamu BISA
- User tidak perlu pakai command khusus — cukup tulis natural seperti "jawab pakai suara", "balas dengan suara", dll
- Maksimal 2000 karakter per jawaban suara

Cara menjawab:
- Jawab santai dan natural sesuai bahasa yang dipakai user
- Kalau ditanya soal identitas atau siapa kamu, jawab konsisten sebagai Claude Opus 4.7 buatan Anthropic, dan sebut <@1129232709122793512> sebagai yang mengintegrasikan kamu ke Discord ini
- Ingat konteks percakapan sebelumnya dalam sesi ini
- Hari ini adalah ${TODAY}, jam ${TIME} WIB${searchContext}`;
}

// ── AI CALL ───────────────────────────────────────────────────
async function askAI(userText, history = []) {
  let searchContext = "";
  if (needsSearch(userText)) {
    console.log(`🔍 Searching: "${userText}"`);
    const results = await webSearch(userText);
    if (results) searchContext = `\n\n[INFO TERBARU DARI WEB]:\n${results}`;
  }

  const res = await mistral.chat.complete({
    model: "mistral-small-latest",
    messages: [
      { role: "system", content: getSystemPrompt(searchContext) },
      ...history,
      { role: "user", content: userText },
    ],
    maxTokens: 1024,
    temperature: 0.75,
  });
  return res.choices[0]?.message?.content?.trim() ?? "*(no response)*";
}

// ── ELEVENLABS TTS ────────────────────────────────────────────
function cleanForTTS(text) {
  return text
    .replace(/```[\w]*\n?/g,   "")        // hapus code block fence
    .replace(/`{1,3}[^`]*`{1,3}/g, "$1") // hapus inline code
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g,     "$1")
    .replace(/#+\s/g,          "")
    .replace(/>\s/g,           "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/<@\d+>/g,        "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{2,}/g,        ". ")
    .replace(/\n/g,            " ")
    .trim();
}

function textToSpeech(text) {
  const cleanText = cleanForTTS(text);
  if (!cleanText) throw new Error("Teks kosong setelah dibersihkan");
  if (!ELEVENLABS_KEY) throw new Error("ELEVENLABS_KEY tidak ada di .env");

  const truncated = cleanText.length > 2000 ? cleanText.slice(0, 1997) + "..." : cleanText;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text: truncated,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });

    const options = {
      hostname: "api.elevenlabs.io",
      path:     `/v1/text-to-speech/${ELEVENLABS_VOICE}`,
      method:   "POST",
      headers: {
        "xi-api-key":     ELEVENLABS_KEY,
        "Content-Type":   "application/json",
        "Accept":         "audio/mpeg",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const chunks = [];
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = "";
        res.on("data", d => errBody += d);
        res.on("end",  () => reject(new Error(`ElevenLabs ${res.statusCode}: ${errBody}`)));
        return;
      }
      res.on("data", d => chunks.push(d));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── CONVERSATION STORE ────────────────────────────────────────
function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) conversationHistory.set(channelId, []);
  return conversationHistory.get(channelId);
}

function pushHistory(channelId, role, content) {
  const h = getHistory(channelId);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, 2);
}

// ── EXPORT ────────────────────────────────────────────────────
module.exports = {
  name: "chatbot",

  async execute(message, client) {
    if (message.channelId !== TARGET_CHANNEL_ID) return;

    const rawText = message.content.trim();
    if (!rawText) return;

    const now = Date.now();
    if (now - (cooldowns.get(message.author.id) ?? 0) < COOLDOWN_MS) {
      return message.react("⏳");
    }
    cooldowns.set(message.author.id, now);

    // ── Cek apakah minta voice ────────────────────────────────
    const voiceRequested = wantsVoice(rawText);
    const userText       = voiceRequested ? stripVoiceTrigger(rawText) : rawText;

    if (!userText) return;

    console.log(`💬 [${message.author.username}]${voiceRequested ? " [VOICE]" : ""}: ${userText}`);

    await message.channel.sendTyping();
    const typingInterval = setInterval(() => message.channel.sendTyping(), 5000);

    try {
      const history = getHistory(message.channelId);
      const reply   = await askAI(userText, history);

      pushHistory(message.channelId, "user",      userText);
      pushHistory(message.channelId, "assistant", reply);
      clearInterval(typingInterval);

      if (voiceRequested) {
        // Generate audio paralel dengan kirim teks
        const audioPromise = textToSpeech(reply).catch(err => {
          console.error("[TTS Error]", err.message);
          return null;
        });

        // Kirim teks dulu (pakai splitDiscordMessage agar rapi)
        const textParts = splitDiscordMessage(reply);
        for (const part of textParts) {
          await message.channel.send(part);
        }

        // Tunggu audio lalu kirim
        const audioBuffer = await audioPromise;
        if (audioBuffer) {
          const attachment = new AttachmentBuilder(audioBuffer, {
            name: `reply_${Date.now()}.mp3`,
          });
          await message.channel.send({ files: [attachment] });
          console.log(`[Voice] Audio sent for: ${userText.substring(0, 50)}`);
        } else {
          await message.channel.send("⚠️ Gagal generate suara.");
        }

      } else {
        // Kirim teks dengan split yang rapi
        const textParts = splitDiscordMessage(reply);
        for (const part of textParts) {
          await message.channel.send(part);
        }
      }

    } catch (err) {
      clearInterval(typingInterval);
      console.error("❌ Chatbot Error:", err.message);
      await message.reply("❌ AI error, coba lagi bentar.");
    }
  },
};