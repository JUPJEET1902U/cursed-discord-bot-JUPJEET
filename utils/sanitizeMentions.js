/**
 * utils/sanitizeMentions.js
 * CURSED bot mention protection for Discord.js v14
 */

function sanitizeMentions(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') text = String(text);

  let out = text;

  // Block @everyone and @here by inserting zero-width space
  out = out.replace(/@everyone/gi, '@\u200Beveryone');
  out = out.replace(/@here/gi, '@\u200Bhere');

  // DO NOT replace user mentions globally
  // We rely on allowedMentions to control exactly who can be pinged

  // Replace role mentions
  out = out.replace(/<@&\d+>/g, '[role]');

  // Replace channel mentions
  out = out.replace(/<#\d+>/g, '[channel]');

  return out;
}

/**
 * Safe reply: only allows pinging the author if explicitly requested
 */
async function createSafeReply(message, content, { mentionAuthor = false } = {}) {
  const payload = {
    content: sanitizeMentions(content),
    allowedMentions: {
      parse: [],
      users: mentionAuthor ? [message.author.id] : [],
      roles: [],
      repliedUser: false
    }
  };
  return message.reply(payload);
}

/**
 * Safe channel send: no mentions allowed
 */
async function createSafeMessage(channel, content) {
  const payload = {
    content: sanitizeMentions(content),
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false
    }
  };
  return channel.send(payload);
}

/**
 * Safe interaction reply
 */
async function createSafeInteractionReply(interaction, content, options = {}) {
  const payload = {
    content: sanitizeMentions(content),
    allowedMentions: {
      parse: [],
      users: options.mentionUser ? [interaction.user.id] : [],
      roles: [],
      repliedUser: false
    },
    ephemeral: !!options.ephemeral
  };
  return interaction.reply(payload);
}

/**
 * Safe interaction followUp
 */
async function createSafeInteractionFollowUp(interaction, content, options = {}) {
  const payload = {
    content: sanitizeMentions(content),
    allowedMentions: {
      parse: [],
      users: options.mentionUser ? [interaction.user.id] : [],
      roles: [],
      repliedUser: false
    }
  };
  return interaction.followUp(payload);
}

module.exports = {
  sanitizeMentions,
  createSafeReply,
  createSafeMessage,
  createSafeInteractionReply,
  createSafeInteractionFollowUp
};
