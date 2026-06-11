#!/usr/bin/env python3
# scripts/ap-handler.py
#
# Usage:
#   py -3.11 ap-handler.py "teks pesan"           → cek teks/link
#   py -3.11 ap-handler.py --image /path/file.png → cek gambar via Mistral Vision
#
# Output:
#   "⚠️ PHISHING DETECTED\n<reason>"   → phishing
#   "✅ SAFE[\n<url info>]"             → aman

import sys
import os
import re
import json
import base64
import requests
from urllib.parse import urlparse

# Force UTF-8 output — Windows default (cp1252) can't encode emoji
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

# ── Load .env ────────────────────────────────────────────────────────────────
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

load_env()

MISTRAL_KEY     = os.getenv('MISTRAL_KEY', '')
TAVILY_KEY      = os.getenv('TAVILY_KEY', '')
MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'

# ── Domain lists & patterns ──────────────────────────────────────────────────
BLACKLISTED_DOMAINS = {
    "discorcl.com", "dlscord.com", "discord-nitro.com", "discordapp.gift",
    "discordnitro.gift", "discord-gift.com", "discocrd.com", "discordgift.site",
    "steampowered.gift", "steamcommunity.ru", "steam-gift.com",
    "cryptogiveaway.io", "mrbeast-crypto.com", "nitro-free.xyz",
    "free-nitro.xyz", "claimnitro.net", "gift-discord.com",
}

LEGIT_DOMAINS = {
    "discord.com", "discord.gg", "discordapp.com",
    "steampowered.com", "steamcommunity.com",
    "youtube.com", "youtu.be", "twitch.tv",
    "paypal.com", "binance.com", "mrbeast.com",
    "github.com", "vercel.app", "netlify.app",
    "google.com", "instagram.com", "twitter.com", "x.com",
}

BRAND_KEYWORDS = ["discord", "steam", "mrbeast", "youtube", "twitch", "paypal", "binance", "nitro"]

PHISHING_PATTERNS = [
    r"free\s*nitro",
    r"discord\s*nitro\s*(gift|giveaway|gratis)",
    r"claim\s*(your|ur)?\s*nitro",
    r"(free|gratis)\s*(crypto|bitcoin|ethereum|usdt|btc|eth)",
    r"(giveaway|hadiah)\s*(crypto|bitcoin|mrbeast)",
    r"withdraw\s*(bonus|reward|usdt|btc)",
    r"(launch|launching)\s*(my|our|new)\s*(crypto|casino|token)",
    r"giving\s*away\s*\$[\d,]+",
    r"free\s*steam\s*(gift|card|key)",
    r"click\s*(here|link)\s*to\s*claim",
    r"register\s*(now|today)\s*(and|to)\s*(get|claim|receive)",
    r"your\s*(withdrawal|payment)\s*was\s*successful",
    r"giving\s*away.*everyone\s*who\s*registers",
    r"nitro\s*gratis",
    r"(dapatkan|klaim|ambil)\s*(nitro|crypto|bitcoin|hadiah|reward|bonus)",
    r"(bergabung|join)\s*(sekarang|buruan|cepat|yuk).{0,30}(gratis|nitro|hadiah|free|bonus)",
    r"(gratis|free).{0,20}(bergabung|join|daftar|register)",
    r"(hadiah|bonus|reward)\s*(gratis|cuma-cuma|percuma)",
    r"(daftar|register).{0,20}(bonus|hadiah|reward|gratis)",
    r"(tarik|withdraw|cairkan)\s*(saldo|dana|uang|bonus)",
    r"(menangkan|menang|win)\s*(uang|crypto|bitcoin|hadiah)",
    r"(investasi|invest).{0,20}(untung|profit|keuntungan)\s*(besar|gede|tinggi)",
    r"penarikan.*berhasil",
    r"(klik|tekan)\s*(link|tautan|di sini).{0,20}(klaim|dapatkan|ambil)",
    r"(buruan|cepetan|buru-buru).{0,30}(terbatas|limited|habis)",
    r"(gabung|join)\s*(sini|saja|aja).{0,20}(mau|untuk|buat).{0,20}(nitro|gratis|free)",
    r"free\s*money",
    r"join.{0,30}free\s*money",
    r"(join|gabung).{0,30}(free|gratis).{0,20}(money|uang|duit|cash)",
    r"(earn|make|dapat|dapatkan).{0,20}(money|uang|duit).{0,20}(fast|cepat|mudah|easy)",
    r"(easy|mudah|gampang).{0,20}(money|uang|duit)",
    r"(double|2x|lipat).{0,20}(uang|money|profit|modal)",
    r"(profit|cuan|penghasilan).{0,20}(dijamin|guaranteed|pasti|100%)",
    r"(passive|pasif).{0,10}(income|penghasilan)",
    r"(get|dapatkan|klaim)\s*(free|gratis)\s*(money|uang|duit|cash|reward)",
]

# ── Helpers ──────────────────────────────────────────────────────────────────
def extract_urls(text):
    return re.findall(r'https?://[^\s<>"\'`]+', text)

def is_typosquat(domain):
    domain = domain.lower().replace("www.", "")
    if domain in LEGIT_DOMAINS:
        return False
    return any(brand in domain for brand in BRAND_KEYWORDS)

# ── Mistral (sync) ───────────────────────────────────────────────────────────
def mistral_chat(messages, model="mistral-small-latest", max_tokens=300):
    if not MISTRAL_KEY:
        return ""
    headers = {
        "Authorization": f"Bearer {MISTRAL_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.1,
    }
    try:
        resp = requests.post(MISTRAL_API_URL, headers=headers, json=payload, timeout=20)
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"[Mistral Error] {e}", file=sys.stderr)
        return ""

# ── Tavily ───────────────────────────────────────────────────────────────────
def tavily_check_domain(domain):
    if not TAVILY_KEY:
        return False, ""
    try:
        resp = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": TAVILY_KEY,
                "query": f"is {domain} phishing scam discord",
                "max_results": 2,
                "search_depth": "basic",
            },
            timeout=10,
        )
        data = resp.json()
        combined = " ".join(r.get("content", "") for r in data.get("results", [])).lower()
        if any(kw in combined for kw in ["phishing", "scam", "malware", "fake", "fraud"]):
            return True, f"Domain `{domain}` teridentifikasi berbahaya (web search)"
    except Exception as e:
        print(f"[Tavily Error] {e}", file=sys.stderr)
    return False, ""

# ── AI URL analyzer ──────────────────────────────────────────────────────────
URL_CHECK_PROMPT = """Kamu adalah sistem keamanan siber yang menganalisis URL mencurigakan.

Analisis URL berikut dan tentukan:
1. Apakah URL ini berpotensi phishing/scam/berbahaya?
2. Kalau aman, kira-kira fungsinya untuk apa?

Jawab HANYA dalam format JSON berikut, tanpa teks lain:
{"is_phishing": true/false, "confidence": "high/medium/low", "reason": "penjelasan singkat bahasa Indonesia", "description": "kalau aman: fungsi site ini untuk apa (maks 1 kalimat)"}"""

def ai_check_url(url):
    try:
        raw = mistral_chat(
            messages=[{"role": "user", "content": f"{URL_CHECK_PROMPT}\n\nURL: {url}"}],
            model="mistral-small-latest",
            max_tokens=200,
        )
        if not raw:
            return False, "", ""
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        result = json.loads(raw)
        is_phishing = result.get("is_phishing", False)
        confidence  = result.get("confidence", "low")
        reason      = result.get("reason", "")
        description = result.get("description", "")
        if is_phishing and confidence in ("high", "medium"):
            return True, f"[{confidence.upper()}] {reason}", ""
        else:
            return False, "", description
    except Exception as e:
        print(f"[AI URL Error] {e}", file=sys.stderr)
        return False, "", ""

# ── Mistral Vision — analisis gambar ─────────────────────────────────────────
VISION_PROMPT = """Kamu adalah sistem moderasi Discord pendeteksi phishing/scam.

Tugasmu adalah mendeteksi gambar yang AKTIF menipu pengguna, bukan gambar yang membahas topik keamanan secara edukatif.

TIDAK PHISHING (jangan flag):
- Konten edukasi / tips keamanan / cara menghindari phishing
- Artikel, infografis, atau panduan bertema "waspada penipuan"
- Screenshot tutorial keamanan siber
- Gambar yang MEMPERINGATKAN orang tentang bahaya phishing

PHISHING (flag ini):
- Halaman fake giveaway (Discord Nitro, crypto, Steam gratis)
- UI palsu withdrawal/transfer crypto dengan tombol "Claim" / "Withdraw"
- Impersonasi figur publik (MrBeast, YouTuber) untuk minta klik link
- Pesan "Withdrawal Successful" / "You've won" yang meminta tindakan
- Form login palsu yang meniru situs resmi (Discord, Steam, bank)
- QR code atau link pendek yang mengarah ke tawaran hadiah tidak masuk akal

KUNCI: Apakah gambar ini sedang MENCOBA MENIPU pembaca untuk klik/daftar/transfer sekarang?
Kalau iya → phishing. Kalau hanya membahas/menjelaskan tentang phishing → BUKAN phishing.

Jawab HANYA JSON berikut, tanpa teks lain:
{"is_phishing": true/false, "confidence": "high/medium/low", "reason": "penjelasan singkat bahasa Indonesia"}"""

def analyze_image_file(filepath):
    """Analisis file gambar lokal pakai Mistral Vision (pixtral)."""
    ext = filepath.rsplit('.', 1)[-1].lower()
    mime_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png",  "webp": "image/webp",
        "gif": "image/gif",
    }
    mime = mime_map.get(ext, "image/png")

    try:
        with open(filepath, 'rb') as f:
            image_data = f.read()
        b64 = base64.standard_b64encode(image_data).decode('utf-8')
        data_url = f"data:{mime};base64,{b64}"

        raw = mistral_chat(
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text",      "text": VISION_PROMPT},
                ],
            }],
            model="pixtral-12b-2409",
            max_tokens=200,
        )
        if not raw:
            return False, ""

        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        result = json.loads(raw)

        is_phishing = result.get("is_phishing", False)
        confidence  = result.get("confidence", "low")
        reason      = result.get("reason", "")

        # Hanya flag kalau confidence HIGH — cegah false positive konten edukatif
        if is_phishing and confidence == "high":
            return True, f"[{confidence.upper()}] {reason}"

    except Exception as e:
        print(f"[Vision Error] {e}", file=sys.stderr)

    return False, ""

# ── Text/link check ──────────────────────────────────────────────────────────
def check_text_phishing(text):
    """Return (is_phishing, reason, safe_url_description)"""
    text_lower = text.lower()

    for pattern in PHISHING_PATTERNS:
        if re.search(pattern, text_lower):
            return True, "Pola teks mencurigakan terdeteksi", ""

    safe_descriptions = []
    for url in extract_urls(text):
        try:
            domain = urlparse(url).netloc.lower().replace("www.", "")
        except Exception:
            continue

        if domain in LEGIT_DOMAINS:
            continue
        if domain in BLACKLISTED_DOMAINS:
            return True, f"Domain blacklist: `{domain}`", ""
        if is_typosquat(domain):
            return True, f"Domain typosquatting: `{domain}`", ""

        flagged, reason = tavily_check_domain(domain)
        if flagged:
            return True, reason, ""

        phishing, ai_reason, description = ai_check_url(url)
        if phishing:
            return True, ai_reason, ""
        elif description:
            safe_descriptions.append(f"`{url}` — {description}")

    safe_info = "\n".join(safe_descriptions) if safe_descriptions else ""
    return False, "", safe_info

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    args = sys.argv[1:]

    if not args:
        print("❌ No input provided", file=sys.stderr)
        sys.exit(1)

    # ── Mode: --image <filepath> ──────────────────────────────────────────
    if args[0] == '--image':
        if len(args) < 2:
            print("❌ --image requires a filepath", file=sys.stderr)
            sys.exit(1)
        filepath = args[1]
        if not os.path.exists(filepath):
            print(f"❌ File not found: {filepath}", file=sys.stderr)
            sys.exit(1)

        is_phishing, reason = analyze_image_file(filepath)
        if is_phishing:
            print(f"⚠️ PHISHING DETECTED\n{reason}")
        else:
            print("✅ SAFE")

    # ── Mode: teks/link biasa ─────────────────────────────────────────────
    else:
        text = args[0]
        is_phishing, reason, safe_info = check_text_phishing(text)
        if is_phishing:
            print(f"⚠️ PHISHING DETECTED\n{reason}")
        elif safe_info:
            print(f"✅ SAFE\n{safe_info}")
        else:
            print("✅ SAFE")