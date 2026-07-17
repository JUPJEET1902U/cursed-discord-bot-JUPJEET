require("dotenv/config")

const { installSecurityBootstrap } = require("./utils/security")

try {
    installSecurityBootstrap()
} catch (err) {
    console.error(`Security bootstrap failed: ${err?.message || err}`)
    process.exit(1)
}

require("./index")
