// commands/findscript.js

const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

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
    .setName("findscript")
    .setDescription("Cari Roblox script dari library")
    .addStringOption((opt) =>
      opt.setName("nama").setDescription("Nama script / game").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("mode").setDescription("Filter tipe script").addChoices(
        { name: "Semua", value: "all" },
        { name: "Free", value: "free" },
        { name: "Paid", value: "paid" }
      )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const query = interaction.options.getString("nama");
    const mode = interaction.options.getString("mode") || "all";

    const params = new URLSearchParams({ q: query, max: "50" });
    if (mode === "free") params.set("paid", "false");
    if (mode === "paid") params.set("paid", "true");

    const url = `https://rscripts.net/api/v2/scripts?${params.toString()}`;

    let scripts = [];
    try {
      const res = await safeFetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      scripts = data?.scripts || [];
    } catch (err) {
      return interaction.editReply({
        content: `❌ Gagal mengambil script: \`${err.message}\`\nCoba lagi beberapa saat.`,
      });
    }

    if (!scripts.length) {
      return interaction.editReply({
        content: `🔍 Tidak ada script ditemukan untuk **"${query}"**`,
      });
    }

    let currentIndex = 0;

    scripts.sort((a, b) => {
      const aContains = a.title.toLowerCase().includes(query.toLowerCase());
      const bContains = b.title.toLowerCase().includes(query.toLowerCase());
      if (aContains !== bContains) return aContains ? -1 : 1;
      return (b.views || 0) - (a.views || 0);
    });

    const buildScriptEmbed = (index) => {
      const s = scripts[index];
      const badges = [];
      if (s.keySystem) badges.push("🔑 Key");
      badges.push(s.paid ? "💰 Paid" : "🆓 Free");

      const gameLabel = s.game?.title ? `🎮 ${s.game.title}` : "🎮 Universal";
      const views = s.views?.toLocaleString() || "0";
      const link = s.slug ? `[🔗 Lihat Script](https://rscripts.net/script/${s.slug})` : "";

      let imageUrl = null;
      if (s.image) imageUrl = s.image;
      else if (s.thumbnail) imageUrl = s.thumbnail;
      else if (s.slug) imageUrl = `https://rscripts.net/img/scripts/${s.slug}.jpg`;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${s.title}`)
        .setDescription(
          [
            gameLabel,
            `> **\`👁️ ${views} views\`**`,
            `> **\`${badges.join(" • ")}\`**`,
            "",
            link,
          ].filter(Boolean).join("\n")
        )
        .setFooter({ text: `rscripts.net • Cari: "${query}"${mode !== "all" ? ` • ${mode}` : ""}` })
        .setTimestamp();

      if (imageUrl) embed.setImage(imageUrl);
      return embed;
    };

    const msg = await interaction.editReply({
      embeds: [buildScriptEmbed(currentIndex)],
      components: [createPaginationButtons(currentIndex, scripts.length)],
    });

    const collector = msg.createMessageComponentCollector({
      filter: (btn) => btn.user.id === interaction.user.id,
      time: 300_000,
    });

    collector.on("collect", async (btn) => {
      if (btn.customId === "next") currentIndex = Math.min(currentIndex + 1, scripts.length - 1);
      else if (btn.customId === "prev") currentIndex = Math.max(currentIndex - 1, 0);

      await btn.update({
        embeds: [buildScriptEmbed(currentIndex)],
        components: [createPaginationButtons(currentIndex, scripts.length)],
      });
    });

    collector.on("end", () => {
      msg.edit({ components: [] }).catch(() => {});
    });
  }
};
