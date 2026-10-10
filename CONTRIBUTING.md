# Contributing to Venture

## Branch Naming

Always branch off `main`. Name your branch after what you're doing:

- `feat/pixel-font-title` — new feature
- `fix/rsvp-button-mobile` — bug fix
- `design/hero-rebrand` — visual/CSS changes
- `docs/update-readme` — documentation only

Never commit directly to `main`. Always open a PR.

## Pull Requests

- Keep PRs small and focused. One thing per PR.
- Write a short description of what you changed and why.
- At least one other team member must approve before merging.
- If your PR is a WIP, prefix the title with `[WIP]` so nobody merges it early.

## Commit Messages

Write in plain English. Say what changed, not what you did.

Good: `Replace Off-Track title image with CSS pixel font`
Bad: `changed stuff` / `WIP` / `update`

## Who Owns What

| Area | Owner |
|------|-------|
| User-facing frontend (landing, RSVP, shop UI) | AzCodes |
| Admin-facing frontend (dashboard, review panel) | Abdulgafar |
| Art, logos, mascot, visual assets | Ayushi |
| Media, social, external comms | DAS |
| Backend / server / database | Abdulgafar |

If you need to touch someone else's area, let them know first in #venture-construction.

## Secrets and Environment Variables

**Never commit `.env` files.** Never hardcode API keys, tokens, or passwords.
If you need a new env variable, add it to `.env.example` with a placeholder value and tell the team in Slack.

## Questions?

Ask in #venture-construction before you spend hours on something that might conflict with someone else's work.
