// events/ready.js

module.exports = {
  name: 'ready',
  once: true,
  
  async execute(client) {
    console.log(`\n✅ Bot successfully logged in as: ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} guild(s)`);
  }
};
