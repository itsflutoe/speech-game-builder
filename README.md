# Speech Game Builder

Educational speech-to-text spelling games with **Vosk offline voice** (PWA) and **single-file offline export**.

## Live site (GitHub Pages)

After enabling Pages (Settings → Pages → Deploy from branch `main` / root):

**https://itsflutoe.github.io/speech-game-builder/**

- **Teacher dashboard:** `/` or `/index.html`
- **Player:** `/play.html` (lesson data in the URL hash)

### How offline mic works on the website

1. Open the site **once while online** (Chrome or Edge).
2. Allow the microphone when asked.
3. Wait until status says offline voice is ready (model ~40 MB, cached by the service worker).
4. Later visits can use the **mic offline**. Type and Tiles always work.

### Offline export (no website)

In the dashboard, click **Export Offline HTML**.
Students double-click the file. **Type / Tiles / Hear word** work offline. Mic uses the browser service when online.

### Share play link

On the hosted site, open a lesson and click **Share play link** to copy a student URL for that lesson.

## Local test

Any static server works, for example:

```bash
npx --yes serve .
```

Then open the URL it prints (usually http://localhost:3000).

## Stack

Vanilla HTML/CSS/JS · Web Speech API fallback · Vosk (vosk-browser) · PWA service worker
