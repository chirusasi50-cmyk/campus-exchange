# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Marketplace Listings API (MongoDB)

The backend now exposes listing endpoints under `/api/listings`:

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/api/listings` | Public |
| GET | `/api/listings/:id` | Public |
| GET | `/api/listings/mine` | Logged-in user |
| POST | `/api/listings` | Logged-in user |
| PUT | `/api/listings/:id` | Listing owner |
| DELETE | `/api/listings/:id` | Listing owner |
| PUT | `/api/listings/admin/:id` | Admin |
| DELETE | `/api/listings/admin/:id` | Admin |

Send the JWT as `Authorization: Bearer <token>` for protected endpoints. The backend assigns the listing owner from the authenticated account; it does not trust a client-supplied owner or seller value. Admin endpoints require a JWT whose database user has `role: "admin"`.

The React app uses the listing APIs for the marketplace and campus block dashboards. Set `VITE_API_URL` in the frontend environment when the API is not at `http://localhost:5001/api`. Configure `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_URL` in `backend/.env` before starting the backend. `CLIENT_URL` defaults to Vite's `http://localhost:5173`. Do not commit or share `.env`.

## Deploying to Vercel, Render, and MongoDB Atlas

The frontend and API deploy as separate services. Keep the environment files out of source control; use `.env.example` and `backend/.env.example` as variable-name references.

### 1. Create the Atlas database

Create a MongoDB Atlas cluster and database user, then copy its connection string. Set the Atlas network access list to allow connections from your Render service. For a quick setup, Atlas can allow access from anywhere (`0.0.0.0/0`); use a narrower allowlist when your deployment supports stable outbound IPs.

### 2. Deploy the API to Render

Create a **Web Service** from this repository with:

- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`

Add these environment variables in Render:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Atlas connection string |
| `JWT_SECRET` | Long, unique random secret |
| `JWT_EXPIRES_IN` | `1d` (optional) |
| `CLIENT_URL` | Vercel production URL, e.g. `https://your-app.vercel.app` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Credentials from your email provider |
| `EMAIL_FROM` | Verified sender address (optional) |

Render supplies `PORT` automatically. After deployment, confirm `https://your-api.onrender.com/api/health` returns an OK response. Set `CLIENT_URL` to the exact Vercel origin, without a trailing slash, and redeploy the API after changing it.

### 3. Deploy the frontend to Vercel

Import the repository into Vercel with the **Vite** framework preset and the repository root as the project root. Add this environment variable before deploying:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | Render API origin, e.g. `https://your-api.onrender.com` (no `/api`) |

The app appends `/api` itself. `vercel.json` rewrites client-side routes such as `/login` to the Vite entry point. After deployment, copy the Vercel production origin into Render's `CLIENT_URL` and redeploy Render.

Signup and password recovery send email codes, so configure working SMTP credentials before expecting those flows to complete. Restart or redeploy a service whenever its environment variables change.
