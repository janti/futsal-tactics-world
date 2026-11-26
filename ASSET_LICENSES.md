# Asset Licenses

All current game assets are **original and generated procedurally in code** at runtime. No
third-party models, textures, fonts, sounds or music are included.

| Asset                                                                  | Source                                                                     | License      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------ |
| Player models and animation                                            | `src/rendering/PlayerModel.ts` (procedural geometry)                       | Project code |
| Parquet, court markings, ball, nets, shirt numbers, advertising boards | `src/rendering/textures.ts` (Canvas 2D)                                    | Project code |
| Arena geometry and spectators                                          | `src/rendering/CourtRenderer.ts`                                           | Project code |
| Fonts                                                                  | Local system fonts only (no bundled or remote fonts)                       | —            |
| National teams                                                         | Country names and plain colours only; no crests, logos or federation marks | Project data |
| Club names, player names                                               | Fictional, seeded generation (`src/data`)                                  | Project data |
| README screenshots (`docs/images`)                                     | Captured from the game itself                                              | Project data |

`public/favicon.svg` comes from the Vite project template (MIT) and will be replaced with an original icon.

Any future external asset must be listed here with source, author and license before it is added.
Paid asset packs must never become mandatory dependencies.

Real players' names are not licensed and are never part of the game or the repository. They can only
be added by the player for private local play via git-ignored files in `src/data/local/` (read by the
dev server only).
