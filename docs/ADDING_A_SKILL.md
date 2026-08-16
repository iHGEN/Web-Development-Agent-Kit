# Adding a Web Skill

1. Create `pack/skills/<skill-name>/SKILL.md`.
2. Add frontmatter:
   - `name`
   - `description`
3. Add detection rules to `pack/router/skill-map.json`.
4. Prefer strong signals:
   - dependency in package/composer/csproj;
   - framework configuration file;
   - build manifest.
5. Avoid scanning `.env` or secret-bearing files for detection.
6. Run detector smoke tests.

A skill should contain technology knowledge. Do not turn every library into a separate agent.
