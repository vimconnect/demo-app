# Vim Connect Demo App

OAuth-enabled demo application for Vim Connect SDK using Next.js.

## Quick Start

```bash
# Local development (uses local SDK build)
npm run dev

# Staging (uses remote staging SDK)
npm run dev:staging
```

App runs at `http://localhost:8080`

## Environment-Based Configuration

**One variable to rule them all:** `NEXT_PUBLIC_ENV`

Set this to `local`, `staging`, or `production` and everything else is calculated automatically:

| ENV | SDK URL | Backend URL | App URL |
|-----|---------|-------------|---------|
| `local` | `/vim-sdk.js` | `http://localhost:3000` | `window.location.origin` |
| `staging` | `https://apps-sdk.stage.getvim.ai/...` | `https://api.stage.getvim.ai` | `window.location.origin` |
| `production` | `https://apps-sdk.getvim.ai/...` | `https://api.getvim.ai` | `window.location.origin` |

**Optional Overrides:** Set `NEXT_PUBLIC_VIM_BACKEND_URL` or `NEXT_PUBLIC_APP_URL` to override defaults.

## OAuth Flow

1. Extension embeds iframe: `http://localhost:8080/launch?launch_id=xxx`
2. App redirects to Vim OAuth: `/app-auth/authorize`
3. Vim redirects back: `http://localhost:8080/app?code=yyy`
4. App exchanges code for token via `/api/auth/token`
5. App initializes SDK: `VimSDK.init({ accessToken })`

## NPM Scripts

```bash
npm run dev              # Local (copies SDK from monorepo)
npm run dev:staging      # Staging (remote SDK)
npm run build            # Build for local
npm run build:staging    # Build for staging
```

## Configuration

### Minimum Required Variables

```env
NEXT_PUBLIC_ENV=local              # local | staging | production (REQUIRED)
NEXT_PUBLIC_CLIENT_ID=your_id      # OAuth client ID (REQUIRED)
CLIENT_SECRET=your_secret          # OAuth client secret - server-only (REQUIRED)
```

**⚠️ Strict Validation:** The app will **fail fast** if any required variable is missing or invalid. No fallbacks, no silent failures.

**Error example:**
```
EnvValidationError: Environment validation failed:
  - NEXT_PUBLIC_ENV is required. Set to: local, staging, or production
  - NEXT_PUBLIC_CLIENT_ID is required
```

### Optional Override Variables

```env
NEXT_PUBLIC_VIM_BACKEND_URL=...    # Override backend URL
NEXT_PUBLIC_APP_URL=...            # Override app URL
```

See `.env.local.example` for details.

---

## Architecture

### OAuth Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ 1. Extension creates launch_id → Embeds iframe          │
│    http://localhost:8080/launch?launch_id=lnch_abc123   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Landing Page (/launch)                               │
│    - Extract launch_id from URL                         │
│    - Generate CSRF token                                │
│    - Store: sessionStorage[oauth_state_${launch_id}]    │
│    - Auto-redirect to Vim OAuth                         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Vim Backend (/app-auth/authorize)                    │
│    - Validates launch_id (one-time use)                 │
│    - Validates client_id                                │
│    - Issues authorization code                          │
│    - Redirects with code                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Main App (/app) - OAuth Callback                     │
│    - Receives code & state from URL                     │
│    - Validates CSRF state token                         │
│    - Calls own backend: POST /api/auth/token            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Backend API (/api/auth/token)                        │
│    - Server-side only (protects CLIENT_SECRET)          │
│    - Calls Vim: POST /app-auth/token                    │
│    - Exchanges code + client credentials for token      │
│    - Returns access_token to frontend                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 6. Main App - SDK Initialization                        │
│    - Calls: VimSDK.init({ accessToken })                │
│    - SDK sends VIM_SDK_READY with token                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 7. Extension - Token Validation                         │
│    - Validates token signature via /app-auth/verify     │
│    - Validates token claims (app_id, launch_id)         │
│    - Establishes MessageChannel                         │
│    - Sends VIM_SDK_INIT                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
                 Connected! ✅
```

### Component Architecture

```
demo-app/
│
├── Frontend (Next.js Pages)
│   │
│   ├── / (Root)
│   │   └── Redirects to /launch with query params
│   │
│   ├── /launch (OAuth Launcher)
│   │   ├── Receives: launch_id from iframe URL
│   │   ├── Generates: CSRF state token
│   │   ├── Stores: sessionStorage[oauth_state_${launch_id}]
│   │   └── Redirects: to Vim /app-auth/authorize
│   │
│   └── /app (Main App + OAuth Callback)
│       ├── Receives: code & state from OAuth redirect
│       ├── Validates: CSRF state token
│       ├── Exchanges: code for token via API
│       ├── Initializes: VimSDK with accessToken
│       └── Displays: Event log, manifest, SDK demo
│
├── Backend (Next.js API Routes)
│   │
│   └── /api/auth/token (Token Exchange)
│       ├── Accepts: { code, redirect_uri }
│       ├── Validates: code is present
│       ├── Calls: Vim backend /app-auth/token
│       ├── Sends: client_id + client_secret (server-side)
│       └── Returns: { access_token, expires_in, ... }
│
├── SDK Loading (Environment-Based)
│   │
│   └── layout.tsx
│       ├── Reads: NEXT_PUBLIC_ENV
│       ├── Calculates: SDK URL via sdk-config.ts
│       │   ├── local → /vim-sdk.js
│       │   ├── staging → https://apps-sdk.stage.getvim.ai/...
│       │   └── production → https://apps-sdk.getvim.ai/...
│       └── Loads: SDK with beforeInteractive strategy
│
└── Build Scripts
    └── prepare-sdk.sh
        ├── Checks: NEXT_PUBLIC_ENV
        ├── If local: copies SDK from packages/vim-sdk/dist
        └── If staging/prod: skips (uses remote URL)
```

### Security Architecture

```
┌─────────────────────────────────────────────────────────┐
│ CSRF Protection (Per OAuth Flow)                        │
├─────────────────────────────────────────────────────────┤
│ Launch:                                                  │
│   - Generate unique state: crypto.randomUUID()          │
│   - Store: sessionStorage[oauth_state_${launch_id}]     │
│   - Send to Vim: state parameter in authorize URL       │
│                                                          │
│ Callback:                                                │
│   - Extract: launch_id from state (format: id:token)    │
│   - Retrieve: stored token from sessionStorage          │
│   - Validate: received token === stored token           │
│   - Clean up: remove used token from storage            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Multi-Tab Isolation                                      │
├─────────────────────────────────────────────────────────┤
│ Problem: Multiple tabs share sessionStorage             │
│                                                          │
│ Solution: Key state by unique launch_id                 │
│   - Tab 1: oauth_state_lnch_abc123 = token1             │
│   - Tab 2: oauth_state_lnch_xyz789 = token2             │
│   - No collisions! Each flow is independent             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Client Secret Protection                                 │
├─────────────────────────────────────────────────────────┤
│ ❌ Frontend: NEVER accesses CLIENT_SECRET                │
│ ✅ Backend API: Uses CLIENT_SECRET in /api/auth/token   │
│                                                          │
│ Flow:                                                    │
│   Frontend → /api/auth/token { code }                   │
│   Backend → Vim /app-auth/token { code, client_secret } │
│   Backend → Frontend { access_token }                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Token Lifecycle                                          │
├─────────────────────────────────────────────────────────┤
│ 1. Received from API → stored in component state        │
│ 2. Used immediately for SDK.init()                      │
│ 3. SDK establishes MessageChannel                       │
│ 4. Token no longer needed (discarded on unmount)        │
│                                                          │
│ No localStorage, no sessionStorage persistence!         │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
Extension                 App Frontend              App Backend              Vim Backend
    │                          │                         │                        │
    │ 1. Create launch_id      │                         │                        │
    ├─────────────────────────>│                         │                        │
    │  (iframe embed)           │                         │                        │
    │                           │                         │                        │
    │                           │ 2. Generate state       │                        │
    │                           │    Store in session     │                        │
    │                           │                         │                        │
    │                           │ 3. Redirect to OAuth    │                        │
    │                           ├────────────────────────────────────────────────>│
    │                           │  (with launch_id, state)│                        │
    │                           │                         │                        │
    │                           │                         │ 4. Validate launch     │
    │                           │                         │    Issue auth code     │
    │                           │<────────────────────────────────────────────────┤
    │                           │  (redirect with code)   │                        │
    │                           │                         │                        │
    │                           │ 5. Validate state       │                        │
    │                           │    Call backend API     │                        │
    │                           ├────────────────────────>│                        │
    │                           │  { code }               │                        │
    │                           │                         │                        │
    │                           │                         │ 6. Exchange code       │
    │                           │                         ├───────────────────────>│
    │                           │                         │  (with client_secret)  │
    │                           │                         │                        │
    │                           │                         │<───────────────────────┤
    │                           │                         │  { access_token }      │
    │                           │                         │                        │
    │                           │<────────────────────────┤                        │
    │                           │  { access_token }       │                        │
    │                           │                         │                        │
    │                           │ 7. SDK.init({ token })  │                        │
    │                           │                         │                        │
    │ 8. Validate token         │                         │                        │
    │<──────────────────────────┤                         │                        │
    │   VIM_SDK_READY           │                         │                        │
    │                           │                         │                        │
    │ 9. Establish channel      │                         │                        │
    ├──────────────────────────>│                         │                        │
    │   VIM_SDK_INIT            │                         │                        │
    │                           │                         │                        │
    │ 10. Events & API calls    │                         │                        │
    │<─────────────────────────>│                         │                        │
    │   (MessageChannel)        │                         │                        │
```

---

## Project Structure

```
demo-app-oauth/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Root (redirects to /launch)
│   │   ├── layout.tsx                # Loads SDK based on ENV
│   │   │
│   │   ├── launch/
│   │   │   └── page.tsx              # OAuth launcher
│   │   │                             # - Receives launch_id
│   │   │                             # - Generates CSRF state
│   │   │                             # - Redirects to Vim OAuth
│   │   │
│   │   ├── app/
│   │   │   └── page.tsx              # Main app + OAuth callback
│   │   │                             # - Validates state
│   │   │                             # - Exchanges code for token
│   │   │                             # - Initializes SDK
│   │   │                             # - Displays event log
│   │   │
│   │   └── api/
│   │       └── auth/
│   │           └── token/
│   │               └── route.ts      # Token exchange endpoint
│   │                                 # - Server-side only
│   │                                 # - Protects CLIENT_SECRET
│   │
│   └── lib/
│       └── sdk-config.ts             # SDK URL calculation
│                                     # - local → /vim-sdk.js
│                                     # - staging → remote URL
│
├── scripts/
│   └── prepare-sdk.sh                # Copies SDK (ENV=local only)
│
├── public/
│   └── vim-sdk.js                    # SDK (generated, gitignored)
│
├── .env.local                        # Local config (ENV=local)
├── .env.staging                      # Staging config (ENV=staging)
├── package.json                      # Scripts for all environments
├── tsconfig.json                     # TypeScript config
├── next.config.js                    # Next.js config (CORS)
└── README.md                         # This file
```
