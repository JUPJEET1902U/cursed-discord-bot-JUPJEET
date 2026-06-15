/**
 * @fileoverview GuildMemberAdd event handler.
 * Fires when a new member joins a server. Assigns default role and sends
 * an AI-generated welcome message.
 */

"use strict"

const logger = require("../utils/logger")
const { askSafe } = require("../utils/aiHelper")
const { PROMPTS } = require("../config/constants")

/** Default role ID to assign to new members (configurable via env) */
const DEFAULT_ROLE_ID = process.env.DEFAULT_ROLE_ID || "1514144073555116202"

/**
 * @param {import("discord.js").GuildMember} member
 */
async function execute(member) {
    logger.info("GuildMemberAdd", `${member.user.tag} joined ${member.guild.name}`)

    // ── Assign Default Role ────────────────────────────────────────────────────
    if (DEFAULT_ROLE_ID) {
        try {
            await member.roles.add(DEFAULT_ROLE_ID)
        } catch (err) {
            logger.warn("GuildMemberAdd", `Could not assign default role: ${err.message}`)
        }
    }

    // ── Welcome Message ────────────────────────────────────────────────────────
    const channel = member.guild.systemChannel
        || member.guild.channels.cache.find(c =>
            c.isTextBased() &&
            c.permissionsFor(member.guild.members.me)?.has("SendMessages")
        )

    if (!channel) return

    const name = member.displayName || member.user.username

    const welcomeText = await askSafe([
        { role: "system", content: PROMPTS.WELCOME },
        { role: "user",   content: `Welcome this new member: ${name}` },
    ], {
        maxTokens: 150,
        context:   "GuildMemberAdd",
        fallback:  `Welcome to the server! CURSED is watching you. 👀`,
    })

    try {
        await channel.send(`👋 ${member} ${welcomeText}`)
    } catch (err) {
        logger.warn("GuildMemberAdd", `Could not send welcome message: ${err.message}`)
    }
}

module.exports = { name: "GuildMemberAdd", once: false, execute }
