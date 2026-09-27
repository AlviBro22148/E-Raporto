<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Landing page is a single scrolling page (src/routes/index.tsx) with sections in src/components/landing/ — the brief asked for one page with anchor nav.
- All UI copy lives in src/i18n/translations.ts (AL default, EN) and is read via useI18n() — no hardcoded strings.
- Contact form writes to public.contact_messages (insert-only for visitors) — no public reads.
