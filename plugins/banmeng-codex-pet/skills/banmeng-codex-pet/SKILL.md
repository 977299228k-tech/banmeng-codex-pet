---
name: banmeng-codex-pet
description: Start, stop, refresh, or inspect the local BANMENG white-haired Codex desktop pet. Use when the user asks about the desktop pet, Codex quota display, task activity overlay, or pet runtime status.
---

# BANMENG Codex Pet

This plugin controls a local Electron desktop companion. It reads quota through the local Codex App Server and receives lifecycle activity through plugin hooks.

## Commands

Run commands from this skill directory only after resolving the plugin root two levels above it.

- Start or reveal: `node <plugin-root>/scripts/start-pet.cjs`
- Stop: `node <plugin-root>/scripts/stop-pet.cjs`
- Refresh quota: send an HTTP POST to `http://127.0.0.1:47831/refresh`
- Health check: send an HTTP GET to `http://127.0.0.1:47831/health`

Starting an already-running pet returns it to the primary display and reveals the window. Report whether the local endpoint responded. Never request or expose account tokens. The app-server process uses the user's existing Codex authentication.
