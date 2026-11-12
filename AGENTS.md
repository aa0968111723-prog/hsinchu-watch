# Working on Hsinchu Watch

This repository is the editable source for https://hsinchu-watch.pages.dev/.

Use `npm run build` to assemble all 17 HTML pages. `build:ui` and `.build-ui/`
contain only an intermediate frontend build. Release the complete `dist/`.

The full published snapshot lives in `public/data/` and `public/observations/`.
Merge incoming records with `tools/release/recover_public_data.py` before
replacing a snapshot, retain newer corrections, and respect review exclusions.
Keep data collection timestamps separate from UI update timestamps.

Maintain one shared statistics snapshot for charts and numeric tables. Poll
scales remain 0–100%, numbers require verified source records, and the blackout
checks remain active. Preserve source links, photo attribution and anonymized
comment excerpts.

The editorial depth layer is `public/editorial-depth.css`; shared long-page
navigation is `public/page-tools.js`. Keep text level, touch targets usable at
320 px, and respect reduced-motion preferences.

Validate relevant changes using `python tools/audit_publication.py`,
`npm run test:release`, `npm run build` and `npm run test:browser`. Never include
local login stores, environment secrets, raw commenter accounts or agent work
directories in repository synchronization.
