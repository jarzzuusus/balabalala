// handlers/message-handler.js

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');

const DEOBF_CHANNEL  = process.env.DEOBF_CHANNEL_ID || "1513509286419103764";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID   || "0";

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

console.log(`[Message-Handler] DEOBF_CHANNEL: ${DEOBF_CHANNEL}`);
console.log(`[Message-Handler] LOG_CHANNEL_ID: ${LOG_CHANNEL_ID}`);
console.log(`[Message-Handler] Anti-Phishing: ALL channels (text + image)`);

// ─────────────────────────────────────────────
// PYTHON RUNNER
// ─────────────────────────────────────────────
function runPythonScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const python = spawn('py', ['-3.11', scriptPath, ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    let output = '';
    let error  = '';

    python.stdout.on('data', (d) => { output += d.toString(); });
    python.stderr.on('data', (d) => { error  += d.toString(); });

    python.on('close', (code) => {
      console.log(`[Python] Exit ${code} | out: ${output.substring(0, 120)}`);
      if (code === 0) {
        resolve(output.trim());
      } else {
        console.error(`[Python] stderr: ${error}`);
        reject(new Error(error.trim() || `Exit code ${code}`));
      }
    });

    python.on('error', (err) => reject(err));
  });
}

// ─────────────────────────────────────────────
// EMBED BUILDERS
// ─────────────────────────────────────────────
function buildPhishingEmbed(member, reason, detType) {
  return new EmbedBuilder()
    .setTitle('⚠️ Pesan Phishing Dihapus')
    .setColor(0xED4245)
    .addFields(
      { name: '👤 Pengirim',      value: member.toString(), inline: true  },
      { name: '🔍 Jenis Deteksi', value: detType,            inline: true  },
      { name: '📋 Alasan',        value: reason,             inline: false },
    )
    .setFooter({ text: 'Pesan dihapus otomatis oleh Anti-Phishing Bot' });
}

function buildSafeEmbed(urlInfo) {
  return new EmbedBuilder()
    .setTitle('🔍 Hasil Analisis Link')
    .setColor(0x57F287)
    .addFields(
      { name: '✅ Status',    value: 'Link aman', inline: false },
      { name: 'ℹ️ Informasi', value: urlInfo,     inline: false },
    )
    .setFooter({ text: 'Dianalisis oleh Anti-Phishing Bot' });
}

// ─────────────────────────────────────────────
// SHARED: handle phishing action (delete + warn + log)
// ─────────────────────────────────────────────
async function onPhishingDetected(message, client, reason, detType, contentSnippet) {
  // 1. Delete
  try {
    await message.delete();
    console.log(`[AP] DELETED: ${message.author.tag} | #${message.channel.name} | ${reason}`);
  } catch (e) {
    console.error('[AP] Delete error:', e.message);
  }

  // 2. Warning embed (auto-delete 30s)
  try {
    const embed = buildPhishingEmbed(message.author, reason, detType);
    const warn  = await message.channel.send({
      content: `🚨 ${message.author} pesan kamu mengandung konten **phishing/scam** dan telah dihapus otomatis.`,
      embeds:  [embed],
    });
    setTimeout(() => warn.delete().catch(() => {}), 30000);
  } catch (e) {
    console.error('[AP] Warning send error:', e.message);
  }

  // 3. Log channel
  if (LOG_CHANNEL_ID && LOG_CHANNEL_ID !== '0') {
    try {
      const logCh = client.channels.cache.get(LOG_CHANNEL_ID);
      if (logCh) {
        const logEmbed = buildPhishingEmbed(message.author, reason, detType);
        logEmbed.addFields(
          { name: '📍 Channel', value: message.channel.toString(), inline: false },
          { name: '🗒️ Konten',  value: contentSnippet || '*[tidak ada teks]*', inline: false },
        );
        await logCh.send({ embeds: [logEmbed] });
      }
    } catch (e) {
      console.error('[AP] Log error:', e.message);
    }
  }
}

// ─────────────────────────────────────────────
// ANTI-PHISHING CORE
// ─────────────────────────────────────────────
async function handleAntiPhishing(message, client) {
  const scriptPath = path.join(__dirname, '../scripts/ap-handler.py');
  if (!fs.existsSync(scriptPath)) {
    console.error(`[AP] Script not found: ${scriptPath}`);
    return;
  }

  console.log(`[AP] Checking: ${message.author.tag} in #${message.channel.name}`);

  // ── 1. Cek teks & link ──────────────────────────────────────────────────
  if (message.content && message.content.length > 0) {
    try {
      const result = await runPythonScript(scriptPath, [message.content]);

      if (result.includes('⚠️')) {
        const reason = result.split('\n').slice(1).join('\n').trim() || 'Konten mencurigakan';
        await onPhishingDetected(message, client, reason, 'Teks/Link', message.content.substring(0, 400));
        return; // sudah dihapus, stop cek lanjutan

      } else if (result.includes('✅')) {
        const safeInfo = result.split('\n').slice(1).join('\n').trim();
        if (safeInfo) {
          const embed = buildSafeEmbed(safeInfo);
          const msg   = await message.channel.send({ embeds: [embed] });
          setTimeout(() => msg.delete().catch(() => {}), 60000);
        }
      }
    } catch (err) {
      console.error('[AP] Text check error:', err.message);
    }
  }

  // ── 2. Cek gambar attachment ────────────────────────────────────────────
  if (message.attachments.size > 0) {
    for (const att of message.attachments.values()) {
      const ext = att.name.split('.').pop().toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;

      console.log(`[AP] Scanning image: ${att.name}`);

      // Download ke file temp
      const tempFile = path.join(__dirname, `../temp_ap_${Date.now()}_${att.id}.${ext}`);
      try {
        const resp        = await fetch(att.url);
        const arrayBuffer = await resp.arrayBuffer();
        fs.writeFileSync(tempFile, Buffer.from(arrayBuffer));

        const result = await runPythonScript(scriptPath, ['--image', tempFile]);

        if (result.includes('⚠️')) {
          const reason = result.split('\n').slice(1).join('\n').trim() || 'Gambar mencurigakan';
          await onPhishingDetected(message, client, reason, 'Gambar (Mistral Vision)', `[Gambar: ${att.name}]`);
          // Kalau 1 gambar phishing, hapus message → stop loop
          break;
        }

      } catch (err) {
        console.error(`[AP] Image check error (${att.name}):`, err.message);
      } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }
    }
  }

  // ── 3. Cek embed/link preview ───────────────────────────────────────────
  if (message.embeds && message.embeds.length > 0) {
    for (const emb of message.embeds) {
      for (const src of [emb.url, emb.description, emb.title].filter(Boolean)) {
        try {
          const result = await runPythonScript(scriptPath, [src]);
          if (result.includes('⚠️')) {
            const reason = result.split('\n').slice(1).join('\n').trim() || 'Embed mencurigakan';
            await onPhishingDetected(message, client, reason, 'Embed/Preview Link', src.substring(0, 400));
            return;
          }
        } catch (err) {
          console.error('[AP] Embed check error:', err.message);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────
// DEOBFUSCATOR
// ─────────────────────────────────────────────
async function handleDeobfuscator(message) {
  if (message.channelId !== DEOBF_CHANNEL) return;
  if (message.attachments.size === 0) return;

  const luaFiles = message.attachments.filter(a => {
    const fname = a.name.toLowerCase();
    return fname.endsWith('.lua') || fname.endsWith('.lua.txt') || fname.endsWith('.txt');
  });

  if (luaFiles.size === 0) return;
  console.log(`[Deobf] Found ${luaFiles.size} Lua file(s)`);

  for (const att of luaFiles.values()) {
    let processingMsg;
    const startTime = Date.now();
    // Deklarasi di luar try supaya finally selalu bisa hapus
    const tempFile  = path.join(__dirname, `../temp_${Date.now()}_${att.id}.lua`);

    try {
      processingMsg = await message.reply(
        `**Processing File**\n> **Sedang melakukan deobfuscation pada \`${att.name}\`...**`
      );

      const response    = await fetch(att.url);
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(tempFile, Buffer.from(arrayBuffer));

      const scriptPath = path.join(__dirname, '../scripts/deobf-handler.py');
      const result     = await runPythonScript(scriptPath, [tempFile]);

      const elapsed  = ((Date.now() - startTime) / 1000).toFixed(2);
      const baseName = att.name
        .replace(/\.lua\.txt$/i, '')
        .replace(/\.lua$/i, '')
        .replace(/\.txt$/i, '');

      const outFile = new AttachmentBuilder(Buffer.from(result), {
        name: `${baseName}.lua_j4rzzbx-deobf.txt`
      });

      await processingMsg.delete();
      await message.reply({
        content:
          `<:succes:1513827479138078830> **Deobfuscation Successful!**\n` +
          `> \`${att.name}\` was completed in **${elapsed} seconds**.\n\nHere is your result:`,
        files: [outFile]
      });

    } catch (err) {
      console.error('[Deobf] Error:', err.message);
      if (processingMsg) {
        await processingMsg.edit(
          `❌ **Deobfuscation Failed!**\n\`${att.name}\` gagal diproses.\nError: \`${err.message}\``
        ).catch(() => {});
      }
    } finally {
      // Selalu hapus temp file — baik sukses, error, maupun unsupported
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        console.log(`[Deobf] Temp file cleaned: ${tempFile}`);
      }
    }
  }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  name: 'message-handler',

  async execute(message, client) {
    if (message.author.bot) return;

    console.log(`\n[Handler] ${message.author.tag} in #${message.channel?.name || message.channelId}`);
    console.log(`[Handler] Content: "${message.content?.substring(0, 50)}..." | Attachments: ${message.attachments.size}`);

    await handleAntiPhishing(message, client);
    await handleDeobfuscator(message);
  }
};