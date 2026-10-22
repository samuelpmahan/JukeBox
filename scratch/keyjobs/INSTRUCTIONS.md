# Key lookup job (Mixgraph route)

Written for a small model (Haiku) running one batch. It uses no web search, only page fetches, because search
budgets run out fast and search results rarely include store pages. Generate batches with
`npm run keys:batches`; each agent gets one batch file and one output file.

Do NOT use WebSearch. Use only WebFetch on www.mixgraph.io pages, plus Bash to record results.

Your batch file is a JSON array of artist groups: `artist`, `artistSlug`, and `tracks` (each with `track`, `artists`,
`featured`, `title`, `version`; version null means the original mix).

Mixgraph URL patterns:
- Artist page (that artist's 25 most prominent tracks with BPM and Camelot code): `https://www.mixgraph.io/artists/<artistSlug>`
- Track page: `https://www.mixgraph.io/tracks/<first-artist-slug>-<title-slug>`: lowercase, `&` and punctuation removed,
  words joined by `-`. Examples:
  - Riot Ten, "Rail Breaker (feat. Rico Act)" -> `https://www.mixgraph.io/tracks/riot-ten-rail-breaker-feat-rico-act`
  - Riot Ten, "VOLUME" -> `https://www.mixgraph.io/tracks/riot-ten-volume`
  - a remix adds the remix name: Excision, "Virus" (Dubloadz Remix) -> `https://www.mixgraph.io/tracks/excision-virus-dubloadz-remix`

For each artist group:

1. WebFetch the artist page with the prompt: `List every track on this page as: exact title | artists | BPM | Camelot or key | track page URL.`
2. Find each of the group's tracks in that list. Ignore letter case and any "(feat. ...)" part when comparing titles.
   The version must match: an original must not be a remix or VIP; a remix must name the same remixer.
3. For a track not in the artist list, try its track page directly, at most 2 URL guesses per track (with and without
   `-feat-<featured>`, or with `-<remixer>-remix`), using the prompt: `Give exactly: title, artists, BPM, key and
   Camelot code, and the Beatport link if shown. If the page says the track was not found, say NOT FOUND.`
4. Record every track right away with Bash, one line per track:

```
node scratch/keyjobs/record.mjs OUTFILE TRACK "KEY" BPM "URL" mixgraph "short note"
```

   - `KEY` as shown (for example `F Minor`), or the Camelot code if that is all the page shows (for example `4A`); `null` if not found.
   - `BPM` is the number shown, or `null`. `URL` is the Mixgraph track page, or `null`.
   - Not found: `node scratch/keyjobs/record.mjs OUTFILE TRACK null null null null "not on mixgraph"`.

If an artist page says not found, try one slug variant (without a leading "the", or `and` instead of `&`), then try
track pages as in step 3.

If a WebFetch fails with a 429 or "rate limit" error, run `sleep 30` and retry that fetch once; if it fails again,
`sleep 60` and retry one last time, then record the track with the note `rate limited, not checked` (that note puts it
back in the queue).

Run at most three agents at a time: Mixgraph rate-limits the shared proxy.

Record every track in the batch, found or not. When you finish, reply with ONE short line: keys found, not found,
and the output file path.

Then run `npm run keys:collect -- <output files>` and `npm run keys:build` to fold the results into
`data/keys/lookups.json` and `data/lostlands-2018.keys.json`.
