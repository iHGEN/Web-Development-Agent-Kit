# Official Source / Version Policy

Framework, runtime, browser, security, database, CI, and cloud behavior changes over time.

When a task depends on version-sensitive behavior:

1. Detect the version from the repository/lockfile/toolchain.
2. Prefer official framework/runtime/vendor documentation for that version.
3. Do not silently apply guidance from a newer major version to an older project.
4. Do not upgrade merely to make an implementation easier unless the user asks for an upgrade.
5. Record any version assumption in the execution plan/handoff.

For web-platform APIs, use standards/MDN-quality references as appropriate. For security controls, use current OWASP/official framework guidance. For package/framework APIs, prefer the official project documentation.
