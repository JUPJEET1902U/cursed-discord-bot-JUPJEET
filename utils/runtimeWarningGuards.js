const mongoose = require("mongoose")
const discord = require("discord.js")

const MONGO_GUARD_KEY = Symbol.for("cursed.runtimeWarnings.mongoListenerBudget")
const DISCORD_GUARD_KEY = Symbol.for("cursed.runtimeWarnings.discordInteractionFlags")
const PATCHED_METHOD_KEY = Symbol.for("cursed.runtimeWarnings.patchedInteractionMethod")

// CURSED has several independent persistence stores that subscribe once to the
// shared Mongoose connection, while startup connection waiters temporarily add
// one-shot listeners. Node's default limit of ten is lower than this intentional
// architecture. Keep a finite explicit budget so genuine runaway registration
// remains observable without producing a false-positive warning during startup.
const MONGO_LISTENER_BUDGET = 32

function installMongoListenerBudget(connection = mongoose.connection) {
    if (!connection || typeof connection.setMaxListeners !== "function") {
        return { installed: false, previousMax: null, maxListeners: null }
    }

    if (connection[MONGO_GUARD_KEY]) return connection[MONGO_GUARD_KEY]

    const previousMax = typeof connection.getMaxListeners === "function"
        ? connection.getMaxListeners()
        : 10
    const maxListeners = Math.max(previousMax, MONGO_LISTENER_BUDGET)
    connection.setMaxListeners(maxListeners)

    const state = Object.freeze({ installed: true, previousMax, maxListeners })
    Object.defineProperty(connection, MONGO_GUARD_KEY, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: state,
    })
    return state
}

function resolveMessageFlags(flags, discordModule = discord) {
    const MessageFlagsBitField = discordModule.MessageFlagsBitField
    if (typeof MessageFlagsBitField === "function") {
        return new MessageFlagsBitField(flags ?? 0)
    }

    // Test/minimal-runtime fallback. Production Discord.js always provides
    // MessageFlagsBitField, but keeping this path makes the normalizer robust.
    const value = typeof flags === "number" ? flags : 0
    return {
        bitfield: value,
        add(flag) { this.bitfield |= Number(flag || 0); return this },
        remove(flag) { this.bitfield &= ~Number(flag || 0); return this },
    }
}

function normalizeInteractionResponseOptions(options, discordModule = discord) {
    if (!options || typeof options !== "object" || Array.isArray(options)) return options
    if (!Object.prototype.hasOwnProperty.call(options, "ephemeral")) return options

    const normalized = { ...options }
    const ephemeral = normalized.ephemeral
    delete normalized.ephemeral

    const flags = resolveMessageFlags(normalized.flags, discordModule)
    const ephemeralFlag = discordModule.MessageFlags?.Ephemeral ?? 64
    if (ephemeral === true) flags.add(ephemeralFlag)
    else if (ephemeral === false) flags.remove(ephemeralFlag)

    const zero = typeof flags.bitfield === "bigint" ? 0n : 0
    if (flags.bitfield !== zero) normalized.flags = flags.bitfield
    else if (options.flags === undefined) delete normalized.flags
    else normalized.flags = flags.bitfield

    return normalized
}

function findMethodOwner(prototype, methodName) {
    let current = prototype
    while (current && current !== Object.prototype) {
        if (Object.prototype.hasOwnProperty.call(current, methodName)) return current
        current = Object.getPrototypeOf(current)
    }
    return null
}

function patchInteractionMethod(owner, methodName, discordModule) {
    const original = owner?.[methodName]
    if (typeof original !== "function" || original[PATCHED_METHOD_KEY]) return false

    function normalizedInteractionMethod(options, ...args) {
        return original.call(
            this,
            normalizeInteractionResponseOptions(options, discordModule),
            ...args
        )
    }

    Object.defineProperty(normalizedInteractionMethod, PATCHED_METHOD_KEY, {
        value: true,
        enumerable: false,
    })
    Object.defineProperty(normalizedInteractionMethod, "name", {
        configurable: true,
        value: original.name,
    })
    owner[methodName] = normalizedInteractionMethod
    return true
}

function installDiscordInteractionFlagCompatibility(discordModule = discord) {
    if (globalThis[DISCORD_GUARD_KEY]) return globalThis[DISCORD_GUARD_KEY]

    const interactionClasses = [
        discordModule.CommandInteraction,
        discordModule.ChatInputCommandInteraction,
        discordModule.ContextMenuCommandInteraction,
        discordModule.MessageComponentInteraction,
        discordModule.ButtonInteraction,
        discordModule.StringSelectMenuInteraction,
        discordModule.UserSelectMenuInteraction,
        discordModule.RoleSelectMenuInteraction,
        discordModule.MentionableSelectMenuInteraction,
        discordModule.ChannelSelectMenuInteraction,
        discordModule.ModalSubmitInteraction,
    ].filter(Boolean)

    const methodOwners = new Map()
    for (const InteractionClass of interactionClasses) {
        for (const methodName of ["reply", "deferReply", "followUp"]) {
            const owner = findMethodOwner(InteractionClass.prototype, methodName)
            if (owner) methodOwners.set(`${methodName}:${methodOwners.size}`, { owner, methodName })
        }
    }

    // The same mixin method can be reachable through several interaction
    // classes. Patch each unique prototype/method pair only once.
    const seenOwners = new WeakMap()
    let patchedMethods = 0
    for (const { owner, methodName } of methodOwners.values()) {
        let methods = seenOwners.get(owner)
        if (!methods) {
            methods = new Set()
            seenOwners.set(owner, methods)
        }
        if (methods.has(methodName)) continue
        methods.add(methodName)
        if (patchInteractionMethod(owner, methodName, discordModule)) patchedMethods++
    }

    const state = Object.freeze({ installed: true, patchedMethods })
    Object.defineProperty(globalThis, DISCORD_GUARD_KEY, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: state,
    })
    return state
}

const mongoListenerState = installMongoListenerBudget()
const discordInteractionState = installDiscordInteractionFlagCompatibility()

module.exports = {
    MONGO_LISTENER_BUDGET,
    installMongoListenerBudget,
    normalizeInteractionResponseOptions,
    installDiscordInteractionFlagCompatibility,
    mongoListenerState,
    discordInteractionState,
}
