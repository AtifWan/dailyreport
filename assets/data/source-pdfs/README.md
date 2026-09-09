# Drop new reports here

Just put the PDF(s) in this folder — no renaming, no dated subfolders, no need to
pair them up yourself. Both the long/full version and the short version can go in
together, and you can drop several different dates' PDFs in at once.

Then ask Claude to process the new reports. It identifies each PDF's report date and
version (long vs. short) from the **title printed on the page**, not the filename — see
"Telling the two source PDFs apart" in the top-level `README.md` — extracts and verifies
the figures, writes the result to `assets/data/reports/<date>/`, updates
`assets/data/reports/index.json`, and moves the source PDFs into `processed/` so they
don't get re-processed next time.

`scripts/detect_reports.py` (run from the repo root: `python3 scripts/detect_reports.py`)
does the bookkeeping half of this on its own — it reports which dates are waiting here,
which are already done, and flags anything unpaired or unrecognized — without touching
any data. Claude runs this automatically when asked to process what's in this folder,
but you can run it yourself any time just to see what's pending.
