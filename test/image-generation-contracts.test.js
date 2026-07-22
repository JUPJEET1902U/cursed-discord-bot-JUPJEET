const assert = require("node:assert/strict")
const fs = require("node:fs")
const imageGeneration = require("../utils/imageGeneration")
const { COMMAND_REGISTRY } = require("../utils/helpGenerator")
const { applyImageGenerationCatalog } = require("../commands/imageGenerationCatalog")

const referenceUser = {
    id: "146844647535078319",
    username: "Kaiser",
    globalName: "Kaiser",
    displayAvatarURL: options => {
        assert.equal(options.extension, "png")
        assert.equal(options.size, 1024)
        assert.equal(options.forceStatic, true)
        return "https://cdn.discordapp.com/avatars/146844647535078319/avatar.png?size=1024"
    },
}

function mockMessage(content, mentionedUser = null) {
    return {
        content,
        author: { id: "123456789012345678" },
        guild: { id: "987654321098765432" },
        mentions: {
            users: {
                first: () => mentionedUser,
            },
        },
    }
}

const mentionRequest = imageGeneration.parseImagineRequest(
    mockMessage("!imagine <@146844647535078319> as a cyberpunk warrior", referenceUser)
)
assert.equal(mentionRequest.ok, true)
assert.equal(mentionRequest.mode, "generate")
assert.equal(mentionRequest.prompt, "as a cyberpunk warrior")
assert.equal(mentionRequest.referenceUser, referenceUser)
assert.doesNotMatch(mentionRequest.prompt, /146844647535078319/)

const mentionOnly = imageGeneration.parseImagineRequest(
    mockMessage("!imagine <@146844647535078319>", referenceUser)
)
assert.equal(mentionOnly.ok, false)
assert.match(mentionOnly.error, /what to create/i)

const normalRequest = imageGeneration.parseImagineRequest(mockMessage("!imagine jenny"))
assert.equal(normalRequest.ok, true)
assert.equal(normalRequest.prompt, "jenny")
assert.match(imageGeneration.enhanceImagePrompt(normalRequest.prompt), /polished and visually distinctive/i)

assert.deepEqual(imageGeneration.parseImagineRequest(mockMessage("!imagine retry")), { ok: true, mode: "retry" })
assert.deepEqual(imageGeneration.parseImagineRequest(mockMessage("!imagine again")), { ok: true, mode: "retry" })
assert.deepEqual(imageGeneration.parseImagineRequest(mockMessage("!imagine variation")), { ok: true, mode: "variations", count: 1 })
assert.deepEqual(imageGeneration.parseImagineRequest(mockMessage("!imagine variations")), { ok: true, mode: "variations", count: 2 })
assert.deepEqual(imageGeneration.parseImagineRequest(mockMessage("!imagine variations 8")), { ok: true, mode: "variations", count: 2 })

const storedReference = imageGeneration.createStoredRequest(mentionRequest)
assert.equal(storedReference.referenceUserId, referenceUser.id)
assert.match(storedReference.referenceImageUrl, /^https:\/\/cdn\.discordapp\.com\//)
assert.match(storedReference.enhancedPrompt, /supplied reference image/i)
assert.doesNotMatch(storedReference.enhancedPrompt, /<@|146844647535078319/)

const seeds = Array.from({ length: 8 }, () => imageGeneration.createRandomSeed())
for (const seed of seeds) {
    assert.ok(Number.isInteger(seed))
    assert.ok(seed >= 1 && seed <= 2147483646)
}
assert.ok(new Set(seeds).size > 1, "random generation should not reuse one fixed seed")

const textUrlOne = imageGeneration.buildGenerationUrl({ prompt: "a cursed castle", seed: 111 })
const textUrlTwo = imageGeneration.buildGenerationUrl({ prompt: "a cursed castle", seed: 222 })
assert.notEqual(textUrlOne, textUrlTwo, "different seeds must produce different cache keys")
assert.match(textUrlOne, /model=flux/)
assert.match(textUrlOne, /seed=111/)
assert.match(textUrlOne, /enhance=true/)
assert.match(textUrlOne, /negative_prompt=/)

const referenceUrl = imageGeneration.buildGenerationUrl({
    prompt: storedReference.enhancedPrompt,
    seed: 333,
    referenceImageUrl: storedReference.referenceImageUrl,
})
assert.match(referenceUrl, /model=kontext/)
assert.match(referenceUrl, /image=https%3A%2F%2Fcdn\.discordapp\.com/)
assert.match(referenceUrl, /seed=333/)
assert.doesNotMatch(referenceUrl, /%3C%40|146844647535078319/)

const funSource = fs.readFileSync(require.resolve("../commands/fun"), "utf8")
const imagineStart = funSource.indexOf('if (msgLower.startsWith("!imagine"))')
const memeStart = funSource.indexOf('if (msgLower.startsWith("!meme"))')
const imagineSection = funSource.slice(imagineStart, memeStart)
assert.ok(imagineStart >= 0 && memeStart > imagineStart)
assert.match(imagineSection, /handleImagineCommand/)
assert.doesNotMatch(imagineSection, /pollinations\.ai|imageUrl/)

const generatorSource = fs.readFileSync(require.resolve("../utils/imageGeneration"), "utf8")
assert.match(generatorSource, /AttachmentBuilder/)
assert.match(generatorSource, /attachment:\/\//)
assert.match(generatorSource, /Promise\.allSettled/)
assert.match(generatorSource, /POLLINATIONS_API_KEY/)
assert.match(generatorSource, /referenceImageUrl/)
assert.doesNotMatch(generatorSource, /allowedMentions:\s*\{\s*parse:\s*\["everyone"/)

assert.equal(applyImageGenerationCatalog(), true)
const imagineHelp = COMMAND_REGISTRY.fun.commands.find(command => command.name === "!imagine")
assert.ok(imagineHelp)
assert.match(imagineHelp.usage, /retry/)
assert.match(imagineHelp.usage, /variations/)
assert.match(imagineHelp.usage, /@user/)

const envSource = fs.readFileSync(require.resolve("../package.json").replace("package.json", ".env.example"), "utf8")
assert.match(envSource, /POLLINATIONS_API_KEY=/)

console.log("professional image generation contracts passed")
