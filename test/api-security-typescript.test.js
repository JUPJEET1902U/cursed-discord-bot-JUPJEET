const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

const files = [
    "api/server.ts",
    "api/middleware/auth.ts",
    "api/routes/auth.ts",
    "api/services/sessions.ts",
    "test/api-session-hardening.test.ts",
]

for (const relativePath of files) {
    const filename = path.resolve(process.cwd(), relativePath)
    const source = fs.readFileSync(filename, "utf8")
    const result = ts.transpileModule(source, {
        fileName: relativePath,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
    })
    const errors = (result.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    assert.equal(
        errors.length,
        0,
        `${relativePath} TypeScript syntax errors: ${errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, " ")).join("; ")}`
    )
}

console.log("hardened API TypeScript syntax passed")
