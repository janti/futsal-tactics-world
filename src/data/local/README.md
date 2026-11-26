# Local rosters (not in version control)

The published game uses fictional, generated players for every team. For **private, local play** you
can give teams real squads with JSON files in this folder:

- Every `*.json` file here is git-ignored (see `.gitignore`); only `rosters.example.json` is
  committed, and it contains fictional names.
- Team ids: clubs `KFU`, `HCF`, `TAM`, `ONS`; national teams `<CODE>-M` (men) and `<CODE>-W`
  (women), e.g. `FIN-M`, `FIN-W`, `ESP-M`, `BRA-W`. See `src/data/teams.ts`.
- `players`: `name`, optional `number` and `position` as your source writes it. `GK` → keeper,
  `DF`/Fixo/Defender → fixo, `MF`/Ala/Winger/Universal → ala, `FW`/Pivot → pivot, anything else
  (e.g. `FP`) → any outfield slot. The first player of each role starts; the rest fill the remaining
  slots in list order.
- Names and shirt numbers replace the generated ones; attributes stay generated from the team's
  rating.
- Local rosters are read by the dev server (`npm run dev`) only. A production build leaves them out
  (no real names in `dist/`) unless you set `VITE_LOCAL_ROSTERS=1` for a private build.
- Restart the dev server after adding or editing a file. The Quick Match screen shows a note when
  local rosters are loaded.

Do not publish a build made with local rosters: real players' names are not licensed for the game.
