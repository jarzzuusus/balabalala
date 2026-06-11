// commands/executorstatus.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require('discord.js');

const API_BASE = "https://executors.online";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function isWorking(exec) {
  return exec.updateStatus === true;
}

function statusEmoji(exec) {
  return isWorking(exec) ? "✅" : "❌";
}

function statusLabel(exec) {
  return isWorking(exec) ? "Working" : "Offline / Patched";
}

function costLabel(exec) {
  if (exec.free === false && exec.cost) return exec.cost;
  if (exec.free === false) return "Paid";
  return "Free";
}

async function safeFetch(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) throw lastErr;
      if (i < retries) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

function createPaginationButtons(current, total) {
  const row = new ActionRowBuilder();

  const prevBtn = new ButtonBuilder()
    .setCustomId("prev")
    .setLabel("◀ Sebelumnya")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(current === 0);

  const pageBtn = new ButtonBuilder()
    .setCustomId("page_info")
    .setLabel(`${current + 1}/${total}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const nextBtn = new ButtonBuilder()
    .setCustomId("next")
    .setLabel("Berikutnya ▶")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(current === total - 1);

  return row.addComponents(prevBtn, pageBtn, nextBtn);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("executorstatus")
    .setDescription("Lihat status semua executor sekarang")
    .addStringOption((opt) =>
      opt.setName("filter").setDescription("Filter executor").addChoices(
        { name: "Semua", value: "all" },
        { name: "Working", value: "working" },
        { name: "Offline/Patched", value: "offline" },
        { name: "Free", value: "free" },
        { name: "Paid", value: "paid" }
      )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    let executors;
    try {
      const res = await safeFetch(`${API_BASE}/api/executors`);
      executors = await res.json();
    } catch (err) {
      return interaction.editReply({ content: `❌ Gagal fetch executor: ${err.message}` });
    }

    const filter = interaction.options.getString("filter") || "all";
    let filtered = executors;
    if (filter === "working") filtered = executors.filter((e) => isWorking(e));
    else if (filter === "offline") filtered = executors.filter((e) => !isWorking(e));
    else if (filter === "free") filtered = executors.filter((e) => e.free);
    else if (filter === "paid") filtered = executors.filter((e) => !e.free);

    const totalWorking = executors.filter(isWorking).length;
    const ITEMS_PER_PAGE = 5;
    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);

    if (filtered.length === 0) {
      return interaction.editReply({
        content: `❌ Tidak ada executor yang cocok dengan filter **${filter}**`,
      });
    }

    let currentPage = 0;

    const buildStatusEmbed = (page) => {
      const start = page * ITEMS_PER_PAGE;
      const end = start + ITEMS_PER_PAGE;
      const pageItems = filtered.slice(start, end);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📊 Roblox Executor Status")
        .setDescription(
          `**Total:** ${executors.length} executor  •  ✅ **${totalWorking}** Working  •  ❌ **${executors.length - totalWorking}** Offline\n` +
          `**Filter:** ${filter || "all"}  •  **Ditemukan:** ${filtered.length}`
        )
        .setFooter({ text: "Powered by executors.online" })
        .setTimestamp();

      for (const e of pageItems) {
        embed.addFields({
          name: `${statusEmoji(e)} ${e.title}`,
          value: [
            `**Status:** ${statusLabel(e)}`,
            `**Platform:** ${e.platform || "N/A"}  •  **Cost:** ${costLabel(e)}`,
            `**UNC:** ${e.uncPercentage ?? "N/A"}%  •  **Ver:** ${e.version || "N/A"}`,
            e.discordlink ? `[Discord](${e.discordlink})` : "",
          ].filter(Boolean).join("\n"),
          inline: false,
        });
      }

      return embed;
    };

    const msg = await interaction.editReply({
      embeds: [buildStatusEmbed(currentPage)],
      components: [createPaginationButtons(currentPage, totalPages)],
    });

    const collector = msg.createMessageComponentCollector({
      filter: (btn) => btn.user.id === interaction.user.id,
      time: 300_000,
    });

    collector.on("collect", async (btn) => {
      if (btn.customId === "next") currentPage = Math.min(currentPage + 1, totalPages - 1);
      else if (btn.customId === "prev") currentPage = Math.max(currentPage - 1, 0);

      await btn.update({
        embeds: [buildStatusEmbed(currentPage)],
        components: [createPaginationButtons(currentPage, totalPages)],
      });
    });

    collector.on("end", () => {
      msg.edit({ components: [] }).catch(() => {});
    });
  }
};