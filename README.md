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
