// events/interactionCreate.js

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.slashCommands.get(interaction.commandName);
    if (!command) {
      console.log(`[Interaction] Command not found: ${interaction.commandName}`);
      return;
    }

    try {
      console.log(`[Interaction] Executing: ${interaction.commandName} by ${interaction.user.tag}`);
      await command.execute(interaction, client);
    } catch (err) {
      console.error(`[Interaction] Error in ${interaction.commandName}:`, err);
      const errMsg = { content: '❌ Terjadi error saat menjalankan command.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errMsg).catch(() => {});
      } else {
        await interaction.reply(errMsg).catch(() => {});
      }
    }
  }
};
