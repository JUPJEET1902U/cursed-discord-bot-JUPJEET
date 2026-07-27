const { EmbedBuilder, PermissionFlagsBits } = require("discord.js")
const {
    getCustomRoleConfig,
    saveCustomRoleConfig,
    getReservedCommandNames,
    buildRoleCatalog,
    recordCustomRoleAudit,
    sendCustomRoleLog,
} = require("../utils/customRoles")
const {
    BASE_ROLE_COMMANDS,
    MAX_CUSTOM_COMMANDS,
    normalizeCommandName,
    getAllCommandEntries,
    findCommand,
    validateCommandName,
    validateRoleSelection,
    canUseRoleCommand,
    canManageTarget,
    resolveToggleAction,
} = require("../utils/customRolePolicy")

const COOLDOWN_MS = 3_000
const cooldowns = new Map()
const ADMIN_COMMANDS = new Set(["reqrole", "rolecmd", "rolecommands"])

function reply(message, payload) {
    const data = typeof payload === "string" ? { content: payload } : payload
    return message.reply({
        ...data,
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    }).catch(() => null)
}

function isSetupAdmin(message) {
    return message.author.id === message.guild.ownerId
        || message.member.permissions.has(PermissionFlagsBits.Administrator)
        || message.member.permissions.has(PermissionFlagsBits.ManageGuild)
}

function getCooldownRemaining(guildId, userId) {
    const key = `${guildId}:${userId}`
    const expiresAt = cooldowns.get(key) || 0
    if (expiresAt > Date.now()) return Math.ceil((expiresAt - Date.now()) / 1000)
    cooldowns.set(key, Date.now() + COOLDOWN_MS)
    if (cooldowns.size > 5_000) {
        const now = Date.now()
        for (const [storedKey, storedExpiry] of cooldowns) if (storedExpiry <= now) cooldowns.delete(storedKey)
    }
    return 0
}

function commandToken(message) {
    return normalizeCommandName(String(message.content || "").trim().split(/\s+/, 1)[0])
}

function commandArgs(message) {
    return String(message.content || "").trim().split(/\s+/).slice(1)
}

function roleCommandListEmbed(config, guild) {
    const entries = getAllCommandEntries(config).filter(entry => entry.enabled && entry.roleId)
    const required = config.requiredRoleId ? guild.roles.cache.get(config.requiredRoleId) : null
    const lines = entries.map(entry => {
        const role = guild.roles.cache.get(entry.roleId)
        return `\`!${entry.name} @member\` → ${role ? role.name : "Deleted role"}`
    })
    return new EmbedBuilder()
        .setColor(0xC026D3)
        .setTitle("🛡️ Custom Role Commands")
        .setDescription(lines.length ? lines.join("\n") : "No custom role commands are configured yet.")
        .addFields({
            name: "Required Role",
            value: required ? required.name : "Not configured",
            inline: false,
        })
        .setFooter({ text: "Running a configured command toggles the role on the mentioned member." })
}

async function handleReqRole(message, args) {
    if (!isSetupAdmin(message)) {
        await reply(message, "❌ Only the server owner or a member with Administrator/Manage Server can configure req.role.")
        return true
    }
    const config = await getCustomRoleConfig(message.guild.id, { fresh: true })
    const action = String(args[0] || "view").toLowerCase()

    if (action === "view") {
        const role = config.requiredRoleId ? message.guild.roles.cache.get(config.requiredRoleId) : null
        await reply(message, role
            ? `🛡️ Required role: **${role.name}**`
            : "⚠️ No required role is configured. Use `!reqrole set @role`.")
        return true
    }

    if (action === "clear") {
        await saveCustomRoleConfig(
            message.guild.id,
            { ...config, enabled: false, requiredRoleId: null },
            { actorId: message.author.id }
        )
        await recordCustomRoleAudit({ guildId: message.guild.id, actorId: message.author.id, action: "configure", reason: "Required role cleared and feature disabled" })
        await reply(message, "✅ Required role cleared and custom role commands disabled. Set a new req.role before enabling them again.")
        return true
    }

    if (action !== "set") {
        await reply(message, "Usage: `!reqrole set @role`, `!reqrole clear`, or `!reqrole view`.")
        return true
    }

    const role = message.mentions.roles.first()
    const check = validateRoleSelection(role?.id, buildRoleCatalog(message.guild), "required")
    if (!check.ok) {
        await reply(message, `❌ ${check.error}`)
        return true
    }
    await saveCustomRoleConfig(message.guild.id, { ...config, requiredRoleId: role.id }, { actorId: message.author.id })
    await recordCustomRoleAudit({ guildId: message.guild.id, actorId: message.author.id, roleId: role.id, action: "configure", reason: "Required role updated" })
    await reply(message, `✅ Members with **${role.name}** can now use configured custom role commands.`)
    return true
}

async function handleRoleCmd(message, args) {
    if (!isSetupAdmin(message)) {
        await reply(message, "❌ Only the server owner or a member with Administrator/Manage Server can configure role commands.")
        return true
    }

    const config = await getCustomRoleConfig(message.guild.id, { fresh: true })
    const action = String(args[0] || "list").toLowerCase()

    if (["enable", "disable"].includes(action)) {
        if (action === "enable" && !config.requiredRoleId) {
            await reply(message, "❌ Set a required role first with `!reqrole set @role`.")
            return true
        }
        const enabled = action === "enable"
        await saveCustomRoleConfig(message.guild.id, { ...config, enabled }, { actorId: message.author.id })
        await recordCustomRoleAudit({ guildId: message.guild.id, actorId: message.author.id, action: "configure", reason: `Feature ${action}d` })
        await reply(message, enabled ? "✅ Custom role commands enabled." : "⛔ Custom role commands disabled.")
        return true
    }

    if (action === "list") {
        await reply(message, { embeds: [roleCommandListEmbed(config, message.guild)] })
        return true
    }

    if (action === "remove") {
        const name = normalizeCommandName(args[1])
        const existing = findCommand(config, name)
        if (!existing) {
            await reply(message, "❌ That custom role command does not exist.")
            return true
        }
        const isBase = BASE_ROLE_COMMANDS.some(item => item.name === name)
        const next = isBase
            ? {
                ...config,
                baseCommands: config.baseCommands.map(entry => entry.name === name ? { ...entry, roleId: null } : entry),
            }
            : { ...config, customCommands: config.customCommands.filter(entry => entry.name !== name) }
        await saveCustomRoleConfig(message.guild.id, next, { actorId: message.author.id })
        await recordCustomRoleAudit({ guildId: message.guild.id, actorId: message.author.id, commandName: name, action: "configure", reason: "Role command removed" })
        await reply(message, `✅ Removed the \`!${name}\` role mapping.`)
        return true
    }

    if (action !== "add") {
        await reply(message, "Usage: `!rolecmd add <name> @role`, `!rolecmd remove <name>`, `!rolecmd list`, `!rolecmd enable`, or `!rolecmd disable`.")
        return true
    }

    const requestedName = normalizeCommandName(args[1])
    const allNames = getAllCommandEntries(config).map(entry => entry.name)
    const existing = findCommand(config, requestedName)
    const nameCheck = validateCommandName(requestedName, {
        reservedNames: getReservedCommandNames(),
        existingNames: allNames,
        originalName: existing?.name,
    })
    if (!nameCheck.ok) {
        await reply(message, `❌ ${nameCheck.error}`)
        return true
    }

    const role = message.mentions.roles.first()
    const roleCheck = validateRoleSelection(role?.id, buildRoleCatalog(message.guild), "assignable")
    if (!roleCheck.ok) {
        await reply(message, `❌ ${roleCheck.error}`)
        return true
    }

    const isBase = BASE_ROLE_COMMANDS.some(item => item.name === requestedName)
    let next
    if (isBase) {
        next = {
            ...config,
            baseCommands: config.baseCommands.map(entry => entry.name === requestedName
                ? { ...entry, roleId: role.id, enabled: true }
                : entry),
        }
    } else if (existing) {
        next = {
            ...config,
            customCommands: config.customCommands.map(entry => entry.name === requestedName
                ? { ...entry, roleId: role.id, enabled: true }
                : entry),
        }
    } else {
        if (config.customCommands.length >= MAX_CUSTOM_COMMANDS) {
            await reply(message, `❌ This server already has the maximum of ${MAX_CUSTOM_COMMANDS} custom role commands.`)
            return true
        }
        next = {
            ...config,
            customCommands: [...config.customCommands, { name: requestedName, roleId: role.id, enabled: true, base: false }],
        }
    }

    await saveCustomRoleConfig(message.guild.id, next, { actorId: message.author.id })
    await recordCustomRoleAudit({ guildId: message.guild.id, actorId: message.author.id, roleId: role.id, commandName: requestedName, action: "configure", reason: "Role command saved" })
    await reply(message, `✅ Saved \`!${requestedName} @member\` for the **${role.name}** role.`)
    return true
}

async function denyRoleAttempt(message, { entry, commandName, targetId = null, reason, userMessage }) {
    await recordCustomRoleAudit({
        guildId: message.guild.id,
        actorId: message.author.id,
        targetId,
        roleId: entry?.roleId || null,
        commandName,
        action: "deny",
        success: false,
        reason,
    })
    await reply(message, userMessage)
    return true
}

async function handleDynamicRoleCommand(message, commandName, config, entry) {
    if (!config.enabled) {
        await reply(message, "⛔ Custom role commands are currently disabled in this server.")
        return true
    }
    if (!entry.enabled || !entry.roleId) {
        await reply(message, `⚠️ The \`!${commandName}\` role command is not configured.`)
        return true
    }

    const isOwner = message.author.id === message.guild.ownerId
    const isAdministrator = message.member.permissions.has(PermissionFlagsBits.Administrator)
    const hasRequiredRole = config.requiredRoleId ? message.member.roles.cache.has(config.requiredRoleId) : false
    if (!canUseRoleCommand({ isOwner, isAdministrator, hasRequiredRole, requiredRoleId: config.requiredRoleId })) {
        return denyRoleAttempt(message, {
            entry,
            commandName,
            reason: config.requiredRoleId ? "Actor lacks required role" : "Required role is not configured",
            userMessage: config.requiredRoleId
                ? "❌ You need the configured req.role to use this command."
                : "❌ This server has not configured req.role yet.",
        })
    }

    const remaining = getCooldownRemaining(message.guild.id, message.author.id)
    if (remaining) {
        await reply(message, `⏳ Wait ${remaining}s before using another custom role command.`)
        return true
    }

    const target = message.mentions.members.first()
    if (!target) {
        await reply(message, `Usage: \`!${commandName} @member\``)
        return true
    }
    if (target.user.bot) {
        return denyRoleAttempt(message, {
            entry, commandName, targetId: target.id, reason: "Bot targets are blocked",
            userMessage: "❌ Custom role commands cannot target bots.",
        })
    }

    const role = message.guild.roles.cache.get(entry.roleId)
    if (!role) {
        return denyRoleAttempt(message, {
            entry, commandName, targetId: target.id, reason: "Configured role no longer exists",
            userMessage: "⚠️ The configured role was deleted. Ask an administrator to update this command.",
        })
    }
    const roleCheck = validateRoleSelection(role.id, buildRoleCatalog(message.guild), "assignable")
    if (!roleCheck.ok) {
        return denyRoleAttempt(message, {
            entry, commandName, targetId: target.id, reason: roleCheck.error,
            userMessage: `❌ ${roleCheck.error}`,
        })
    }
    if (!target.manageable) {
        return denyRoleAttempt(message, {
            entry, commandName, targetId: target.id, reason: "Target is above CURSED in role hierarchy",
            userMessage: "❌ CURSED cannot manage that member because of Discord role hierarchy.",
        })
    }

    const hierarchy = canManageTarget({
        isOwner,
        isAdministrator,
        actorHighestPosition: message.member.roles.highest.position,
        targetHighestPosition: target.roles.highest.position,
        rolePosition: role.position,
    })
    if (!hierarchy.ok) {
        return denyRoleAttempt(message, {
            entry, commandName, targetId: target.id, reason: hierarchy.error,
            userMessage: `❌ ${hierarchy.error}`,
        })
    }

    const action = resolveToggleAction(target.roles.cache.has(role.id))
    try {
        if (action === "add") await target.roles.add(role, `Custom role command !${commandName} by ${message.author.tag}`)
        else await target.roles.remove(role, `Custom role command !${commandName} by ${message.author.tag}`)

        await recordCustomRoleAudit({
            guildId: message.guild.id,
            actorId: message.author.id,
            targetId: target.id,
            roleId: role.id,
            commandName,
            action,
            success: true,
        })
        await sendCustomRoleLog(message.guild, {
            actorId: message.author.id,
            targetId: target.id,
            roleId: role.id,
            commandName: `!${commandName}`,
            action,
        })

        const embed = new EmbedBuilder()
            .setColor(action === "add" ? 0x2ECC71 : 0xE67E22)
            .setTitle(action === "add" ? "✅ Role Added" : "✅ Role Removed")
            .setDescription(`Successfully ${action === "add" ? "added" : "removed"} **${role.name}** ${action === "add" ? "to" : "from"} **${target.displayName}**.`)
            .setTimestamp()
        await reply(message, { embeds: [embed] })
    } catch (error) {
        await recordCustomRoleAudit({
            guildId: message.guild.id,
            actorId: message.author.id,
            targetId: target.id,
            roleId: role.id,
            commandName,
            action,
            success: false,
            reason: error.message,
        })
        await reply(message, "❌ Discord rejected the role update. Check CURSED's Manage Roles permission and role position.")
    }
    return true
}

async function handle(message) {
    if (!message.guild || message.author.bot) return false
    const name = commandToken(message)
    if (!name) return false
    const args = commandArgs(message)

    try {
        if (name === "reqrole") return await handleReqRole(message, args)
        if (name === "rolecmd") return await handleRoleCmd(message, args)
        if (name === "rolecommands") {
            const config = await getCustomRoleConfig(message.guild.id)
            await reply(message, { embeds: [roleCommandListEmbed(config, message.guild)] })
            return true
        }

        if (ADMIN_COMMANDS.has(name)) return false
        const config = await getCustomRoleConfig(message.guild.id)
        const entry = findCommand(config, name)
        if (!entry) return false
        return await handleDynamicRoleCommand(message, name, config, entry)
    } catch (error) {
        console.error(`[CustomRoles] command failed: ${error.message}`)
        await reply(message, error.code === "MONGO_UNAVAILABLE"
            ? "⚠️ Custom role settings are temporarily unavailable. Try again shortly."
            : "⚠️ The custom role command could not be completed.")
        return true
    }
}

module.exports = {
    handle,
    roleCommandListEmbed,
    isSetupAdmin,
    getCooldownRemaining,
}
