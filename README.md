<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8b75baba-363b-4fab-9724-ba602a2f922f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Desktop build + auto-update (GitHub Releases)

This project is configured to publish Windows installer updates to GitHub Releases using `electron-builder`.

Current publish target in `package.json`:
- owner: `doran`
- repo: `zen-pomodoro`

### One-time setup

1. Create a GitHub Personal Access Token with `repo` scope.
2. Set token in terminal:
   - PowerShell: `$env:GH_TOKEN="your_token_here"`

### Release a new update

1. Increase `version` in `package.json` (for example `0.0.0` -> `0.0.1`).
2. Build and publish release:
   - `npm.cmd run electron:release:github`
3. Electron Builder will upload artifacts to GitHub Releases, including update metadata (`latest.yml` + blockmap).
4. Installed app (NSIS setup build) will detect update on next app start and prompt user to restart to apply it.

### Important notes

- Auto-update is for installed app (`Zen Pomodoro Setup ...exe`), not `win-unpacked` and not portable mode.
- If your GitHub repo is different, edit `build.publish.owner` and `build.publish.repo` in `package.json`.
