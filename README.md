# GiveAgain – Donation & Reuse Platform
https://0zfj4nxb-3000.inc1.devtunnels.ms/

Web platform for donating clothes and household items to verified NGOs, orphanages and individuals, with doorstep pickup scheduling and status tracking.

## Run
```bash
npm install
npm start          # http://localhost:3000
```
Admin login: `admin@donate.local` / `admin123` (change it, and set `JWT_SECRET`, before deploying).

## Roles
- **Donor**: register, list items, choose a verified NGO in their city, schedule pickup, track status and history, rate, report problems.
- **NGO / beneficiary**: register, wait for admin verification, accept or decline requests, mark collected and distributed.
- **Admin**: verify NGOs, monitor all donations, manage categories, resolve complaints, view KPIs (donors, NGOs, totals, repeat rate, avg collection time, rating).

## Structure
- `server.js` – REST API (JWT auth, bcrypt password hashing) and static hosting
- `public/index.html` – responsive single-page frontend
- `db.json` – created on first run (users, donations, complaints, notifications)

## Production notes
Replace `db.json` with MongoDB/PostgreSQL, serve over HTTPS, encrypt personal fields at rest, add email/SMS for notifications, and plug in a Maps API for address search.
