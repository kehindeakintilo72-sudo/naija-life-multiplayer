# Naija Life V2 — Multiplayer Life Simulation

This is an original Lagos-inspired full-stack starter project. It includes:
- Account registration/login with bcrypt password hashing and HTTP-only sessions
- SQLite persistence for player profiles, jobs, virtual money, XP, homes, friends, messages, reports and mutes
- Real-time city chat and player presence using Socket.IO
- Jobs with virtual rewards and a short work cooldown
- Virtual house purchases
- Friend requests and friend-only private messages
- Report submission, mute controls and basic admin report review/player deletion
- Interactive OpenStreetMap/Leaflet map with city travel

## Requirements
Node.js 18+ and npm. On Android, use Termux with Node.js installed.

## Run in Termux
1. Download and extract this ZIP into your Downloads folder.
2. Run:
   ```bash
   termux-setup-storage
   pkg update
   pkg install nodejs unzip -y
   cd ~/storage/downloads
   unzip naija-life-v2-starter.zip
   cd naija-life-v2
   npm install
   ```
3. Start the app with a strong session secret:
   ```bash
   export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
   npm start
   ```
4. Open `http://127.0.0.1:3000`.

## Optional admin account for local testing
The first account registered with the configured admin username AND matching admin password is assigned the admin role. Set these before starting the server:
```bash
export ADMIN_USERNAME="your_admin_name"
export ADMIN_PASSWORD="use-a-long-unique-password"
export SESSION_SECRET="replace-with-a-long-random-secret"
npm start
```
Register that username with that exact password. Do not use the sample credentials in production. For a public deployment, configure environment variables in the hosting dashboard, never commit secrets to GitHub.

## Free online hosting
A simple deployment target is Render (availability and free-tier rules can change):
1. Push the project files to a private or public GitHub repository.
2. Create a Render Web Service connected to that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Set environment variables:
   - `SESSION_SECRET`: a long random secret
   - `NODE_ENV`: `production`
   - `ADMIN_USERNAME`: a unique admin username (optional)
   - `ADMIN_PASSWORD`: a long, unique password (optional)
6. Deploy and test registration, login, live chat, map and property purchases.

### Persistence warning for free hosting
This project uses SQLite in a local file. Some free hosts use ephemeral filesystems, which means the SQLite database may be lost on redeploy/restart. To preserve data online, use a host with a persistent disk or replace SQLite with a managed PostgreSQL database (for example, a free-tier managed database if currently available). Do not assume a free host's filesystem is persistent.

## Security and production-readiness notes
This is a learning prototype, not a hardened production game. Before public use:
- Add CSRF protection and review session/cookie configuration for the chosen host.
- Add robust login rate limiting, email verification, password reset, account recovery and account deletion.
- Use managed PostgreSQL for multi-instance hosting; SQLite is best for a single instance with a persistent disk.
- Add chat moderation, blocking semantics, report escalation, audit logs, admin 2FA, and appeal handling.
- Add transaction logging and fraud checks for the virtual economy.
- Validate all API inputs and run dependency/security updates.
- Add a privacy notice and community rules.
- Never collect payment details or promise real-money rewards.
- Leaflet loads map assets from public CDNs and OpenStreetMap tiles require internet; attribute OpenStreetMap on the map.

## File structure
- `server.js` — Express API, SQLite schema, session auth, Socket.IO and game logic
- `public/index.html` — responsive game UI and interactive map
- `package.json` — dependencies and commands
- `.gitignore` — avoids committing local DB, dependencies and secrets
