const assert = require("node:assert/strict")
const path = require("node:path")
const ts = require("typescript")

const files = [
    "api/server.ts",
    "api/middleware/auth.ts",
    "api/routes/auth.ts",
    "api/services/sessions.ts",
    "test/api-session-hardening.test.ts",
].map(relativePath => path.resolve(process.cwd(), relativePath))

const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    strict: false,
    noEmit: true,
}

const program = ts.createProgram({ rootNames: files, options: compilerOptions })
const errors = ts.getPreEmitDiagnostics(program)
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)

const formatted = errors.map(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
    if (!diagnostic.file || diagnostic.start === undefined) return message
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    const relative = path.relative(process.cwd(), diagnostic.file.fileName)
    return `${relative}:${position.line + 1}:${position.character + 1} ${message}`
})

assert.equal(
    errors.length,
    0,
    `Hardened API TypeScript type errors:\n${formatted.join("\n")}`
)

console.log("hardened API TypeScript typecheck passed")
