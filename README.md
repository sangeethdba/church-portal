# GraceLedger — Church Portal (v2)

The free, secure cloud home for your church's giving, expenses, and
year-end giving statements. Built for treasurers and pastors who want
clarity without spreadsheets.

> **What changed?** This repository went from Express+SQLite + CRA/MUI
> to a **Vite + React + Tailwind/shadcn** front-end backed by
> **Supabase** (Postgres + Auth + Storage), deployable to **Vercel**'s
> free tier. The new code lives at the repo root; the legacy
> `backend/` (Express+Sequelite) and `frontend/` (CRA+Material UI)
> folders are kept for reference only — they are no longer in the
> build path. You can delete them after you migrate production data.

---

## Tech stack (free tier)

| Concern | Provider | Limit |
| --- | --- | --- |
| Auth (Google + email) + Postgres + Storage | [Supabase](https://supabase.com) | 500 MB DB · 1 GB storage · 50k MAU |
| Hosting (static SPA + free edge functions) | [Vercel](https://vercel.com) | 100 GB bandwidth · 10 s serverless |
| Frontend | Vite 5 · React 18 · TypeScript · Tailwind · shadcn/ui primitives | — |
| PDF generation | `jspdf` (runs in the user's browser) | zero server cost |
| Dev preview | Freebuff Cloud preview | `bun run dev` |

---

## Features (v2 — what's actually shipping)

- 🔐 **Google + email sign-in** (Supabase Auth, OAuth + magic-link capable)
- 🛡️ **Row-level security on every table** — members see only their own giving
- 💰 **Donations ledger** with annual statement PDF generation in one click
- 🧾 **Expenses**: members submit receipts; treasurers see a queue and approve / reject / mark **auto-paid**
- 🏛️ **Church-direct expenses** — track rent, utilities, outreach, and outreach-cash in one ledger
- 👥 **Donor directory** with family + individual accounts and per-donor history
- 📄 **IRS-friendly annual statements** generated client-side via jsPDF

### Out-of-scope for v2 (deliberately deferred)

These features exist in the legacy Express backend and can be backfilled on request:

- Weekly offering cash / check bucket grouping with deposit slips
- Pastor-gift deduction logic
- Auto-emailed batch distribution of statement PDFs
- Multi-user draft donation sessions

---

## 5-minute setup (for the church admin)

1. **Create a free Supabase project:** <https://supabase.com/dashboard>
2. **Run the SQL migration** in the Supabase SQL editor:
   `supabase/migrations/0001_init.sql` — creates profiles, donors,
   donations, expenses, reimbursements, tax_receipts, and storage
   buckets + RLS policies.
3. **Enable Google OAuth** in Supabase → Authentication → Providers
   (use the same `Site URL` you'll deploy to).
4. **Paste these two keys** into Freebuff's API Keys tab
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
5. **Promote yourself** to super admin once you sign in:
   ```sql
   update public.profiles
     set role = 'super_admin'
     where email = 'you@yourchurch.org';
   ```
6. **Press Start** in Freebuff preview (already configured below).

---

## Freebuff preview commands (already configured)

| Field | Value |
| --- | --- |
| Install | `bun install` |
| Preview (port 5173) | `bun run dev` |
| Build | `bun run build` |

---

## Environment variables

| Variable | Where to set | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Freebuff → API Keys | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Freebuff → API Keys | Public anon key (safe for the browser — Supabase RLS protects data) |
| `VITE_SITE_URL` | Freebuff → API Keys (optional) | Used for OAuth redirect. Defaults to current site origin. |

---

## Folder layout

```
/
├── package.json          # Vite + React + Supabase + jsPDF
├── vite.config.ts        # SPA + Bun-friendly, HMR off per Freebuff
├── tailwind.config.ts    # Modern Sandstone + Indigo theme tokens
├── vercel.json           # SPA rewrites + asset headers
├── supabase/
│   └── migrations/0001_init.sql   # schema + RLS + storage + auth trigger
└── src/
    ├── pages/            # Landing, Login, AuthCallback, Dashboard, Donors,
    │                     #  Donations, Expenses, TaxReport
    ├── components/       # Layout, RequireAuth, Logo, ui primitives
    └── lib/              # supabase, auth, pdf, utils
```

Legacy folders kept for reference (no longer built):

- `backend/` — original Express+Sequelize+SQLite+JWT API
- `frontend/` — original CRA + Material UI SPA

---

## Security model

- **Row-Level Security** on every financial table — members can only
  SELECT their own rows; admins/treasurers have broader policies.
- **No backend code runs in production.** All read/write happens
  through Supabase's public REST + RLS, which means a single leaked
  anon key still cannot exfiltrate data unless policies are wrong.
- **Storage policies** isolate receipt files per user; only admins
  cross the boundary.
- **Single-source-of-truth role flag** (`profiles.role`). The client
  never trusts role for actual access decisions — only for UI gating.

---

## Deployment

1. Push to GitHub → connect Vercel to your repo.
2. Build command (Vercel auto-detected from `vercel.json`):
   `bun run build`
3. Output directory: `dist`
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as project
   env vars on Vercel.

You'll be on the free tier (Hobby) which is plenty for any single
local church's traffic.

---

## Support & license

- Issues & contributions: open a GitHub issue on
  <https://github.com/sangeethdba/church-portal>.
- License: MIT.

> Built with care for church communities using free-tier cloud
> infrastructure.
