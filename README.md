# Counterline

An Android-friendly web prototype for learning a cantus firmus, singing a second part, and viewing the live interval. No backend, account, audio upload, or npm dependencies.

## Use it

1. Open the practice room, record an unaccompanied cantus phrase, and tap **Finish & save**. Importing audio or loading a synthesized sample also works.
2. Listen back to check the learned melody.
3. Choose **Solo practice**, use headphones, and start. The recorded cantus loops while the microphone follows your second voice.
4. Choose pure ratios or equal temperament. Adjust smoothing and jump confirmation separately.
5. Export WAV files to keep backups or share a cantus with students. Recordings are saved locally in IndexedDB, separately for each device, browser, and origin. Clearing site data deletes them.

The sound demo runs synthesized two-voice audio through the actual detector without microphone access. It is not evidence of accuracy on real choirs.

**Live choir** uses the learned cantus as a guide while measuring both parts live. Begin at the start of the learned phrase. Restart the guide if it loses its place. This mode and phone-speaker playback are experimental.

## Android

Use a current Chrome browser over HTTPS. In the practice room, choose Chrome's **Add to Home screen / Install app**. A service worker caches the practice room for offline use after its first successful load. Keep the app visible while recording or practicing; moving it into the background stops audio. Wired headphones are recommended; Bluetooth introduces device-dependent latency. Adjust Playback alignment if the reference changes do not match what you hear.

## GitHub Pages

The included workflow tests and deploys `dist/` on pushes to `main` and manual runs. In this repository's **Settings → Pages → Build and deployment**, choose **GitHub Actions**. Run **Test and deploy Counterline** from Actions after enabling Pages if the initial run failed. The landing page is at the Pages root and the practice room is at `app/`. All asset paths are relative, so project Pages paths work.

## Development

Requires Node 20+ for tests and Python 3 for the local server:

```sh
npm test
npm start
```

Open `http://localhost:4173/` or `http://localhost:4173/app/`. A phone cannot use microphone access over an ordinary LAN HTTP URL; use the HTTPS deployment. No install or build step is needed.

## How it works

- An AudioWorklet captures mono input, downsampling to 16 kHz using a simple averaging resampler. WAV export is 16-bit PCM mono at 16 kHz; it is a practice recording, not an archival audio format.
- A Web Worker analyzes 4096-sample windows at 1024-sample hops (256 ms window, 64 ms update). These contribute latency in addition to display smoothing and jump confirmation.
- Recording and headphone practice use a YIN-style monophonic detector. Cantus pitch contours are retained without semitone quantization.
- Two-part mode generates harmonic candidates from spectral peaks and jointly scores two harmonic families, requiring independent evidence for each voice. The choir tolerance controls harmonic matching width, not a measured singer-to-singer dispersion.
- The experimental online follower searches local positions in the learned contour, allowing variable progression and modest tuning drift. It handles short phrases best and is not a robust score follower for repeats, arbitrary restarts, or large tempo changes.
- Large pitch jumps must persist before acceptance, then accepted values are smoothed in log-frequency. Missing evidence clears the display. Interval error uses the live pitch ratio (or the recorded pitch at playback time in solo mode).
- Pure targets use one explicitly selected conventional ratio per interval: 1, 16/15, 9/8, 6/5, 5/4, 4/3, sqrt(2), 3/2, 8/5, 5/3, 9/5, 15/8. Tritone uses the equal-tempered midpoint; these are practical reference choices, not a complete context-sensitive just-intonation system.

## Limits and validation

This is a prototype, not a calibrated choir tuner. Tests cover synthesized fundamentals, detuned harmonic mixtures, unequal voice levels, silence/noise, false second voices, interval calculations, jump handling, reference rests, and guide confidence. Real singers, room reverberation, Android audio hardware, and Bluetooth timing require field testing. Exact unisons and octaves may be unresolvable from one microphone. Stored cantus errors can affect both following and headphone interval comparisons.

Phrases are limited to two minutes; imports to 40 MB. Imported audio is decoded by the browser, whose supported formats vary. Microphone input is never routed to the speakers.

## Layout

- `dist/index.html`, `dist/landing.css`: landing page and instructions
- `dist/app/`: installable practice room and DSP
- `tests/dsp.test.js`: deterministic signal and tracking checks
- `.github/workflows/pages.yml`: tests and GitHub Pages publication

Research that informed the design: [score-informed tracking in Soundprism](https://labsites.rochester.edu/air/projects/PriorResearch/PriorResearch.html), [multi-F0 modeling in SATB choirs](https://arxiv.org/abs/1904.05086). This implementation is an independent lightweight heuristic, not a port of those systems.
