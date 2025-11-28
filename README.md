# KPI GPT Backend

This repository contains TypeScript sources under `api/` and `engine/`. A lightweight TypeScript setup is included to verify the code compiles with the configured Node/CommonJS target.

## Why run the typecheck step?

- **Catch compatibility issues early.** The check ensures the `api/` and `engine/` modules share consistent types and compile against the Node/CommonJS target before you deploy code.
- **Keep the repo dependency-free at runtime.** The tooling uses only dev dependencies (`typescript` and `@types/node`) so production behavior is unchanged while still giving you IDE and CI feedback.
- **No build artifacts.** `npm run typecheck` runs `tsc --noEmit`, so it only validates types without producing output files.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the compatibility/type checking step for all working files in `api/` and `engine/`:
   ```bash
   npm run typecheck
   ```
   This runs `tsc --noEmit`, ensuring the codebase type checks without producing build artifacts.

## Notes

- Generated artifacts and dependency folders are ignored via `.gitignore` to keep the repository clean.
- The TypeScript configuration lives in `tsconfig.json` and currently includes every `.ts` file under `api/` and `engine/`, so adding new working files in those folders automatically becomes part of the compatibility check.
