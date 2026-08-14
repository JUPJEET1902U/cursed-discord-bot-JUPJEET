import assert from 'node:assert/strict'
import {
  createSession,
  deleteSession,
  getSession,
  sessionStore,
  tokenDigest,
} from '../api/services/sessions.ts'

function sessionInput(userId = '123456789012345678') {
  return {
    userId,
    username: 'security-test',
    discriminator: '0',
    avatar: null,
    accessToken: 'discord-access-token-test',
  }
}

sessionStore.clear()

const token = createSession(sessionInput())
assert.match(token, /^[a-f0-9]{64}$/i)
const digest = tokenDigest(token)
assert.ok(digest)
assert.equal(sessionStore.has(token), false, 'raw bearer token must not be stored as a Map key')
assert.equal(sessionStore.has(digest as string), true, 'only the token digest should be stored')
assert.equal(getSession(token)?.userId, '123456789012345678')
assert.equal(getSession('not-a-valid-token'), undefined)

deleteSession(token)
assert.equal(getSession(token), undefined)

sessionStore.clear()
const tokens: string[] = []
for (let index = 0; index < 7; index += 1) {
  tokens.push(createSession(sessionInput('223456789012345678')))
}
assert.equal(sessionStore.size, 5, 'per-user session count must be capped')
assert.equal(getSession(tokens[0]), undefined, 'oldest session should be evicted first')
assert.ok(getSession(tokens[tokens.length - 1]), 'newest session should remain valid')

sessionStore.clear()
console.log('dashboard session hardening contracts passed')
