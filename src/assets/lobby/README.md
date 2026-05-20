# Lobby hero image

Drop a single lobby-vibe stock photo here as `lobby.jpg` (or `.png` / `.webp`
/ `.jpeg`). It is loaded by `routes/_authenticated/lobby.tsx` via an optional
`import.meta.glob` — when no file is present, the lobby falls back to a gold
gradient and the faded full-page backdrop is hidden.

Recommended:

- Wide aspect ratio (the hero is ~30dvh tall, full width).
- Dark / moody scene so the overlaid title and verify CTA stay legible.
- < 500 KB so the page paints fast.
