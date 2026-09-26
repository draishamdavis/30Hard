# 30 HARD

A 30-day practice of discipline, wellness, and spiritual formation, designed for iPhone.

## Accounts

Each person creates an account (name, email, password), then a three-step setup personalizes the challenge:

1. **Start date:** today, tomorrow, next Monday, or any chosen date.
2. **Commitments:** turn each daily commitment on or off and set personal targets.
3. **My Why:** the reason and the one word to return to on hard days.

Progress syncs to the account, so it follows the person across devices. The app keeps an offline copy and syncs again when the connection returns.

## Screens

- **Today:** day counter, progress ring, Today's Focus, and nine daily commitment cards.
- **Devotional:** a 30-day reading journey with Reflect, Pray, and Today, plus a private journal.
- **Progress:** a 30-day grid, streak and consistency stats, and per-commitment bars.
- **My Why:** your reason, your word, who you are becoming, and your anchor verse.

Settings (start date, appearance, commitment targets) open from the gear icon in the header.

## Project layout

- `public/`: the app (plain HTML, CSS, and JavaScript, no build step)
- `netlify/functions/api.mts`: the account API at `/api/*` (Netlify Functions)
- `netlify/lib/core.mts`: sign-up, sign-in, sessions, and saved progress
- `test/`: API tests

## Run locally

```
npm install
npm run dev     # http://localhost:8080 with an in-memory account store
npm test
```

## Deploy (Netlify)

1. Link this repository to a Netlify project. `netlify.toml` already sets the publish folder and functions.
2. Add an environment variable named `SESSION_SECRET` (a long random string) scoped to Functions.

Accounts and progress live in Netlify Blobs. Passwords are hashed with scrypt, sessions use signed HttpOnly cookies, and repeated failed sign-ins lock the account for 15 minutes.

## Install on iPhone

Host the folder on any static host with HTTPS, open it in Safari, tap Share, then **Add to Home Screen**. The app works offline after the first visit.

## Editing content

- Commitments and devotionals: `public/data.js`
- Colors and type: tokens at the top of `public/styles.css`

## Credits

Icons from [Lucide](https://lucide.dev) (ISC License). Typeface: [Manrope](https://fonts.google.com/specimen/Manrope) (SIL Open Font License).
