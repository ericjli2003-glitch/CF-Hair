# Project skills

Claude Code loads these automatically in any session opened on this repository.

| Skill | Source | License | Use |
|---|---|---|---|
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Apache 2.0 (`frontend-design/LICENSE.txt`) | Visual direction: palette, type, layout, avoiding templated looks |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) at commit 477bcb2 | MIT (`ui-ux-pro-max/LICENSE`) | UX, accessibility and Next.js rules, and the pre-delivery checklist |

How they are used here: the approved visual direction in `docs/design-plan.md` comes first. `ui-ux-pro-max` is used as the accessibility and usability rulebook; its generated "hair salon" design system (pink and lavender, Playfair and Inter, testimonials carousel) was reviewed and not adopted. Never add testimonials or reviews that the salon has not supplied.

Run the `ui-ux-pro-max` search from the repository root (its scripts are local Python with no network access; the test suite was left out of this copy):

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "focus visible keyboard" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "suspense streaming bundle" --stack nextjs
```
