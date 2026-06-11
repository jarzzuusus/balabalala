// main.js - Discord Bot Main Entry Point

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || "1457999207825936397";

// ── CLIENT SETUP ──────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.commands = new Collection();
client.handlers = new Collection();
client.slashCommands = new Collection();

// ── PYTHON CALLER HELPER ──────────────────────────────────
client.runPython = function(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const python = spawn('python', [`./scripts/${scriptName}.py`, ...args]);
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `Python script error (exit code ${code})`));
      } else {
        resolve(output.trim());
      }
    });

    python.on('error', (err) => {
      reject(err);
    });
  });
};

// ── AUTO LOAD HANDLERS ────────────────────────────────────
async function loadHandlers() {
  const handlersPath = path.join(__dirname, 'handlers');
  if (!fs.existsSync(handlersPath)) {
    fs.mkdirSync(handlersPath);
    return;
  }

  const handlersFiles = fs.readdirSync(handlersPath).filter(f => f.endsWith('.js') && f !== 'loadHandlers.js');

  for (const file of handlersFiles) {
    try {
      const handler = require(path.join(handlersPath, file));
      if (handler.name) {
        client.handlers.set(handler.name, handler);
        console.log(`✅ Handler loaded: ${handler.name}`);
      }
    } catch (err) {
      console.error(`❌ Error loading handler ${file}:`, err.message);
    }
  }
}

// ── AUTO LOAD SLASH COMMANDS ──────────────────────────────
async function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath);
    return;
  }

  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  const commandsArray = [];

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (command.data && command.execute) {
        client.slashCommands.set(command.data.name, command);
        commandsArray.push(command.data.toJSON());
        console.log(`✅ Slash command loaded: ${command.data.name}`);
      }
    } catch (err) {
      console.error(`❌ Error loading command ${file}:`, err.message);
    }
  }

  // Register slash commands
  if (commandsArray.length > 0) {
    try {
      const rest = new REST({ version: '10' }).setToken(TOKEN);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commandsArray });
      console.log(`✅ ${commandsArray.length} slash commands registered`);
    } catch (err) {
      console.error('❌ Error registering slash commands:', err.message);
    }
  }
}

// ── AUTO LOAD EVENTS ──────────────────────────────────────
async function loadEvents() {
  const eventsPath = path.join(__dirname, 'events');
  if (!fs.existsSync(eventsPath)) {
    fs.mkdirSync(eventsPath);
    return;
  }

  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of eventFiles) {
    try {
      const event = require(path.join(eventsPath, file));
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
      console.log(`✅ Event loaded: ${event.name}`);
    } catch (err) {
      console.error(`❌ Error loading event ${file}:`, err.message);
    }
  }
}

// ── INIT ──────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`📡 Client ID: ${client.user.id}`);
  console.log(`🔧 Handlers: ${client.handlers.size}`);
  console.log(`📋 Slash Commands: ${client.slashCommands.size}`);
  console.log(`${'='.repeat(50)}\n`);
});

// ── UNHANDLED REJECTION ───────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('[UnhandledRejection]', err);
});

// ── LOGIN ──────────────────────────────────────────────────
(async () => {
  console.log('[Bot] Starting up...');
  
  await loadHandlers();
  await loadCommands();
  await loadEvents();
  
  if (!TOKEN) {
    console.error('❌ DISCORD_TOKEN tidak ditemukan di .env!');
    process.exit(1);
  }

  if (!CLIENT_ID) {
    console.error('❌ CLIENT_ID tidak ditemukan di .env!');
    process.exit(1);
  }

  await client.login(TOKEN);
})();

module.exports = client;
