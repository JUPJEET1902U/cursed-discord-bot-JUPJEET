# Initial Moderation Security Audit Findings

The existing server-protection layer detects destructive actions after Discord emits them. Its current defaults are disabled and use alert-only responses. Existing anti-nuke defaults permit several destructive actions before containment, and quarantine can fail when role hierarchy, MongoDB, or quarantine-role configuration is unavailable.

## Required fixes in this branch

- Add permission and hierarchy preflight reporting.
- Add immediate-response thresholds for destructive actions.
- Make containment failure visible and incident-backed.
- Add attacker neutralization plus lockdown fallback for critical events.
- Detect dangerous role grants to members, not only role permission edits.
- Detect unsafe channel overwrite escalation and unauthorized bot additions.
- Strengthen anti-raid scoring and active-raid handling.
- Add progressive AutoMod enforcement and staff-safe exemptions.
- Preserve trusted-subject scope isolation.
- Keep all unrelated CURSED systems untouched.
