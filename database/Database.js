/**
 * @fileoverview Database abstraction layer for CURSED Bot.
 *
 * Wraps all JSON file I/O behind a clean interface with:
 * - In-memory caching to reduce disk reads
 * - Atomic writes (write to temp file, then rename)
 * - Automatic periodic backups
 * - Data validation hooks
 * - Future-ready interface for MongoDB migration
 *
 * Usage:
 *   const db = require("./database/Database")
 *   const data = db.read("economy")
 *   db.write("economy", data)
 */

"use strict"

const fs   = require("fs")
const path = require("path")
const logger = require("../utils/logger")
const { FILES } = require("../config/constants")

// ─── Store Registry ───────────────────────────────────────────────────────────

/**
 * Maps store names to their file paths.
 * @type {Record<string, string>}
 */
const STORE_PATHS = {
    economy:      FILES.ECONOMY,
    memory:       FILES.MEMORY,
    pets:         FILES.PETS,
    profiles:     FILES.PROFILES,
    warnings:     FILES.WARNINGS,
    serverConfig: FILES.SERVER_CONFIG,
    premiumCodes: FILES.PREMIUM_CODES,
    roastCounts:  FILES.ROAST_COUNTS,
}

// ─── In-Memory Cache ──────────────────────────────────────────────────────────

/** @type {Map<string, { data: object, dirty: boolean, lastRead: number }>} */
const cache = new Map()

/** Cache TTL in ms — re-read from disk after this duration */
const CACHE_TTL = 5_000

// ─── Backup Configuration ─────────────────────────────────────────────────────

const BACKUP_DIR      = "./backups"
const BACKUP_INTERVAL = 30 * 60 * 1000 // 30 minutes
const MAX_BACKUPS     = 5

// ─── Core I/O ─────────────────────────────────────────────────────────────────

/**
 * Read a store from cache or disk.
 * @param {string} storeName
 * @returns {object}
 */
function read(storeName) {
    const filePath = STORE_PATHS[storeName]
    if (!filePath) {
        logger.error("Database", `Unknown store: ${storeName}`)
        return {}
    }

    const cached = cache.get(storeName)
    const now    = Date.now()

    // Return cached data if fresh
    if (cached && (now - cached.lastRead) < CACHE_TTL) {
        return cached.data
    }

    // Read from disk
    try {
        if (fs.existsSync(filePath)) {
            const raw  = fs.readFileSync(filePath, "utf8")
            const data = JSON.parse(raw)
            cache.set(storeName, { data, dirty: false, lastRead: now })
            return data
        }
    } catch (err) {
        logger.error("Database", `Failed to read ${storeName}: ${err.message}`)
    }

    // Return empty object and cache it
    const empty = {}
    cache.set(storeName, { data: empty, dirty: false, lastRead: now })
    return empty
}

/**
 * Write data to a store (updates cache and writes to disk atomically).
 * @param {string} storeName
 * @param {object} data
 * @returns {boolean} success
 */
function write(storeName, data) {
    const filePath = STORE_PATHS[storeName]
    if (!filePath) {
        logger.error("Database", `Unknown store: ${storeName}`)
        return false
    }

    // Update cache immediately
    cache.set(storeName, { data, dirty: false, lastRead: Date.now() })

    // Atomic write: write to temp file, then rename
    const tmpPath = `${filePath}.tmp`
    try {
        const json = JSON.stringify(data, null, 2)
        fs.writeFileSync(tmpPath, json, "utf8")
        fs.renameSync(tmpPath, filePath)
        return true
    } catch (err) {
        logger.error("Database", `Failed to write ${storeName}: ${err.message}`)
        // Clean up temp file if it exists
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
        return false
    }
}

/**
 * Invalidate the cache for a store, forcing the next read from disk.
 * @param {string} storeName
 */
function invalidate(storeName) {
    cache.delete(storeName)
}

/**
 * Invalidate all cached stores.
 */
function invalidateAll() {
    cache.clear()
}

// ─── Backup System ────────────────────────────────────────────────────────────

/**
 * Create a timestamped backup of all data stores.
 */
function createBackup() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true })
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
        const backupPath = path.join(BACKUP_DIR, timestamp)
        fs.mkdirSync(backupPath, { recursive: true })

        let count = 0
        for (const [name, filePath] of Object.entries(STORE_PATHS)) {
            if (fs.existsSync(filePath)) {
                const dest = path.join(backupPath, path.basename(filePath))
                fs.copyFileSync(filePath, dest)
                count++
            }
        }

        logger.info("Database", `Backup created: ${timestamp} (${count} files)`)

        // Prune old backups
        pruneBackups()
    } catch (err) {
        logger.error("Database", `Backup failed: ${err.message}`)
    }
}

/**
 * Remove old backups, keeping only the most recent MAX_BACKUPS.
 */
function pruneBackups() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return
        const entries = fs.readdirSync(BACKUP_DIR)
            .map(name => ({ name, time: fs.statSync(path.join(BACKUP_DIR, name)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time)

        for (const entry of entries.slice(MAX_BACKUPS)) {
            const dir = path.join(BACKUP_DIR, entry.name)
            fs.rmSync(dir, { recursive: true, force: true })
            logger.debug("Database", `Pruned old backup: ${entry.name}`)
        }
    } catch (err) {
        logger.error("Database", `Backup pruning failed: ${err.message}`)
    }
}

/**
 * Start the automatic backup scheduler.
 */
function startBackupScheduler() {
    // Initial backup on startup
    createBackup()
    // Periodic backups
    setInterval(createBackup, BACKUP_INTERVAL)
    logger.info("Database", `Backup scheduler started (every ${BACKUP_INTERVAL / 60000}m)`)
}

// ─── Convenience Helpers ──────────────────────────────────────────────────────

/**
 * Get a single record from a store by key.
 * @param {string} storeName
 * @param {string} key
 * @param {*}      [defaultValue=null]
 * @returns {*}
 */
function get(storeName, key, defaultValue = null) {
    const data = read(storeName)
    return data[key] !== undefined ? data[key] : defaultValue
}

/**
 * Set a single record in a store by key.
 * @param {string} storeName
 * @param {string} key
 * @param {*}      value
 * @returns {boolean}
 */
function set(storeName, key, value) {
    const data = read(storeName)
    data[key]  = value
    return write(storeName, data)
}

/**
 * Delete a single record from a store by key.
 * @param {string} storeName
 * @param {string} key
 * @returns {boolean}
 */
function del(storeName, key) {
    const data = read(storeName)
    delete data[key]
    return write(storeName, data)
}

/**
 * Check if a key exists in a store.
 * @param {string} storeName
 * @param {string} key
 * @returns {boolean}
 */
function has(storeName, key) {
    const data = read(storeName)
    return key in data
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * Get database statistics.
 * @returns {{ stores: number, cachedStores: number, storeNames: string[] }}
 */
function getStats() {
    return {
        stores:       Object.keys(STORE_PATHS).length,
        cachedStores: cache.size,
        storeNames:   Object.keys(STORE_PATHS),
    }
}

module.exports = {
    read,
    write,
    get,
    set,
    del,
    has,
    invalidate,
    invalidateAll,
    createBackup,
    startBackupScheduler,
    getStats,
    STORE_PATHS,
}
