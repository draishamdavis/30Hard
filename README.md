# 30 HARD

A 30-day practice of discipline, wellness, and spiritual formation, designed for iPhone.

## Screens

- **Today:** day counter, progress ring, Today's Focus, and nine daily commitment cards.
- **Devotional:** a 30-day reading journey with Reflect, Pray, and Today, plus a private journal.
- **Progress:** a 30-day grid, streak and consistency stats, and per-commitment bars.
- **My Why:** your reason, your word, who you are becoming, and your anchor verse.

Settings (start date, appearance, commitment targets) open from the gear icon in the header.

## Run locally

```
node serve.js
```

Then open http://localhost:8080. Plain HTML, CSS, and JavaScript with no build step.

## Install on iPhone

Host the folder on any static host with HTTPS, open it in Safari, tap Share, then **Add to Home Screen**. The app works offline after the first visit.

## Editing content

- Commitments and devotionals: `data.js`
- Colors and type: tokens at the top of `styles.css`

Progress is stored only on the device (`localStorage`).

## Credits

Icons from [Lucide](https://lucide.dev) (ISC License). Typeface: [Manrope](https://fonts.google.com/specimen/Manrope) (SIL Open Font License).
