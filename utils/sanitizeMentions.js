/**
 * Discord mention-safety helpers.
 * User content may be displayed, but mass mentions and arbitrary role/channel
 * pings must never be created accidentally by CURSED.
 */

const SAFE_ALLOWED_MENTIONS = Object.freeze({
    parse: [],
    users: [],
    roles: [],
    repliedUser: false,
})

function sanitizeMentions(text) {
    let output = String(text ?? "")
    output = output.replace(/@everyone/gi, "@\u200Beveryone")
    output = output.replace(/@here/gi, "@\u200Bhere")
    output = output.replace(/@\d{17,20}/g, "[user]")
    output = output.replace(/<@!?\d+>/g, "[user]")
    output = output.replace(/<@&\d+>/g, "[role]")
    output = output.replace(/<#\d+>/g, "[channel]")
    return output
}

function allowedMentionsForUser(userId = null) {
    return {
        ...SAFE_ALLOWED_MENTIONS,
        users: userId ? [String(userId)] : [],
    }
}

async function createSafeReply(message, content, { mentionAuthor = false } = {}) {
    return message.reply({
        content: sanitizeMentions(content),
        allowedMentions: allowedMentionsForUser(mentionAuthor ? message.author.id : null),
    })
}

async function createSafeMessage(channel, content) {
    return channel.send({
        content: sanitizeMentions(content),
        allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
}

async function createSafeInteractionReply(interaction, content, options = {}) {
    const payload = {
        content: sanitizeMentions(content),
        allowedMentions: allowedMentionsForUser(options.mentionUser ? interaction.user.id : null),
        ephemeral: Boolean(options.ephemeral),
    }
    if (interaction.deferred) {
        const { ephemeral: _ephemeral, ...editPayload } = payload
        return interaction.editReply(editPayload)
    }
    if (interaction.replied) return interaction.followUp(payload)
    return interaction.reply(payload)
}

async function createSafeInteractionFollowUp(interaction, content, options = {}) {
    return interaction.followUp({
        content: sanitizeMentions(content),
        allowedMentions: allowedMentionsForUser(options.mentionUser ? interaction.user.id : null),
    })
}

module.exports = {
    SAFE_ALLOWED_MENTIONS,
    sanitizeMentions,
    allowedMentionsForUser,
    createSafeReply,
    createSafeMessage,
    createSafeInteractionReply,
    createSafeInteractionFollowUp,
}
