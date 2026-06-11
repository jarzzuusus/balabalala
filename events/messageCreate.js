// events/messageCreate.js

module.exports = {
  name: 'messageCreate',

  async execute(message, client) {
    // Abaikan bot messages
    if (message.author.bot) return;

    // ── RUN ALL HANDLERS ──────────────────────────────────
    for (const [name, handler] of client.handlers) {
      try {
        if (handler.execute) {
          await handler.execute(message, client);
        }
      } catch (err) {
        console.error(`[Handler ${name}] Error:`, err.message);
      }
    }

    // ── PROCESS PREFIX COMMANDS ───────────────────────────
    const PREFIX = process.env.PREFIX || '!';
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error('[Command Execute]', err);
      await message.reply({ 
        content: '❌ Ada error saat execute command',
        ephemeral: true 
      });
    }
  }
};
