# Asset Licenses

All current game assets are **original and generated procedurally in code** at runtime. No
third-party models, textures, fonts, sounds or music are included.

| Asset                                                                  | Source                                               | License      |
| ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------ |
| Player models and animation                                            | `src/rendering/PlayerModel.ts` (procedural geometry) | Project code |
| Parquet, court markings, ball, nets, shirt numbers, advertising boards | `src/rendering/textures.ts` (Canvas 2D)              | Project code |
| Arena geometry and spectators                                          | `src/rendering/CourtRenderer.ts`                     | Project code |
| Fonts                                                                  | Local system fonts only (no bundled or remote fonts) | —            |
| Club names, player names                                               | Fictional, seeded generation (`src/data`)            | Project data |

`public/favicon.svg` comes from the Vite project template (MIT) and will be replaced with an original icon.

Any future external asset must be listed here with source, author and license before it is added.
Paid asset packs must never become mandatory dependencies.
