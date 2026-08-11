# Study Notes — What Changed & Why

Three areas were added to LinkUp: **geospatial indexing**, a **hybrid recommendation
engine**, and **auth + security**. This doc is a cheat sheet for explaining each one.

---

## 1. Geospatial Indexing (MongoDB 2dsphere)

**Files:** `models/Activity.js`, `utils/geo.js`, `routes/activities.js` (`/nearby`), `routes/recommendations.js`

**The problem it solves:** the old code kept `posts` in a JS array and, to find
nearby posts, would have had to loop over every single one computing distance —
an O(N) scan. At scale (millions of active posts) that's too slow.

**The fix:**
- Activities store `location` as a GeoJSON `Point`: `{ type: 'Point', coordinates: [lng, lat] }`.
  **Order matters — it's `[longitude, latitude]`, the opposite of how people usually say coordinates.**
- `activitySchema.index({ location: '2dsphere' })` builds a special index MongoDB
  uses for spherical (real-world, curved-earth) geo queries.
- Under the hood, MongoDB's 2dsphere index uses a technique similar to
  **geohashing**: it encodes 2D coordinates into a hierarchical grid so nearby
  points share similar keys, and stores those keys in a B-tree. That's what
  turns "find things near X" into an **O(log N)** index lookup instead of a
  full scan — same reason a normal B-tree index speeds up `WHERE age = 25`.
- `$geoNear` (an aggregation stage) or `$nearSphere` (a query operator) are
  the two ways to actually use that index. This project uses `$geoNear`
  because it also returns `distanceField` — the computed distance — for free.

**Likely interview question:** *"Why not just use lat/lng columns and a
bounding-box WHERE clause?"* → A bounding box is still O(N) without a spatial
index, and it's a rough approximation (a "20km box" isn't a 20km radius —
corners are further away than edges). A geospatial index does true radius
math efficiently.

---

## 2. Dynamic Radius Adjustment

**File:** `utils/geo.js` (`getDynamicRadiusKm`)

**The idea:** a 5km radius makes sense in Mumbai, but returns nothing in a
rural area — and a 15km radius in Mumbai would return thousands of irrelevant
results. So the radius should adapt to local density.

**How it's implemented (kept deliberately simple):**
1. Run a small "probe" query — count how many activities exist within a fixed
   5km circle of the user.
2. Bucket that count into a tier: 8+ nearby → dense (2km radius), 3-7 → medium
   (7km), 0-2 → sparse (15km).

This is a **proxy for density**, not real population data — good enough to
demonstrate the concept, and honest to say so if asked. A production version
might instead call a census/population-density API, or compute density from
actual user location pings rather than post density.

**Likely interview question:** *"How would you make this more accurate?"* →
Use a real population-density data source, or make the tiers continuous
(a formula instead of fixed buckets), or factor in time-of-day if activity
density is expected to shift.

---

## 3. Hybrid Recommendation Engine

**Files:** `routes/recommendations.js` (Node side), `backend-ml/ml_service.py` (Python side)

**The architecture — why split geo (Node) from ranking (Python)?**
Geo filtering is cheap and index-backed, so it runs first in Node/Mongo to
narrow "millions of activities" down to "~30 nearby candidates." Only that
small shortlist gets sent to Python for the more expensive ML-style scoring.
This is a standard **candidate generation → ranking** pattern: filter cheap,
rank expensive, and only rank what survived the filter.

Each candidate gets scored on three signals, then combined into one number:

| Signal | What it measures | Where it's computed |
|---|---|---|
| `geo_score` | How close the candidate is (normalized 0-1 by radius) | Node (from Mongo's real distance) |
| `collab_score` | Collaborative filtering — has this user engaged with this activity type before? | Python |
| `content_score` | Content/vector similarity — how similar is the description to what the user usually joins? | Python (TF-IDF + cosine similarity) |

Final score: `0.4·geo + 0.3·collab + 0.3·content + skill_bonus`

**Collaborative filtering, explained simply:** count how many times the user
has joined each `activityType` before, then reward candidates of a type
they've engaged with more. This is a simplified, single-user version of the
real idea — a full system would build this across *all* users (an
item-item or user-item matrix) so it can also say "users like you also
liked...", not just "you personally liked this type before."

**"Vector search / embeddings", explained honestly:** the code uses
`TfidfVectorizer` + `cosine_similarity` from scikit-learn — this converts text
into vectors based on word frequency, and measures the angle between them.
It's a legitimate, classic **content-based filtering** technique, but it is
**not semantic** — it only catches similarity when words overlap, so it won't
know "box cricket" and "leather ball cricket" are related unless "cricket"
being shared is enough signal. A **production upgrade path** (mentioned in
code comments) is to swap `TfidfVectorizer` for a sentence-transformer
embedding model (which captures meaning, not just word overlap) and store
those vectors in a proper vector database like **FAISS** or **Pinecone** for
fast nearest-neighbor lookup at scale. Be upfront about this distinction if
asked — it shows you understand the difference between "vector-shaped" and
"semantically meaningful."

**Likely interview question:** *"Why weight geo at 0.4 and not, say, 0.6?"*
→ Honest answer: these are tunable hyperparameters. In a real system you'd
A/B test different weights against an engagement metric (e.g. join-through
rate) rather than guess.

---

## 4. Auth & Security

**Files:** `models/User.js`, `middleware/auth.js`, `middleware/rateLimiter.js`, `routes/auth.js`

### JWT (JSON Web Tokens)
- **Stateless auth**: instead of the server keeping a session table, the
  token itself contains the user's identity (`id`, `name`, `email`), signed
  with a secret (`JWT_SECRET`) so it can't be forged or edited undetected.
- Client sends it back as `Authorization: Bearer <token>` on every request.
- `middleware/auth.js` verifies the signature and expiry, then attaches the
  decoded payload to `req.user` for downstream routes to use.
- **Passwords** are never stored in plaintext — `bcryptjs` hashes them with a
  salt (`bcrypt.hash(password, 10)`) before saving, and login compares with
  `bcrypt.compare()`, which re-hashes the input and checks equality (you can
  never "decrypt" a bcrypt hash back to the password — that's the point).

### Google OAuth
- The **frontend** would use Google's Sign-In button to get an `idToken`
  directly from Google (not implemented in the UI here — the backend
  endpoint `/api/auth/google` is ready for it).
- The **backend** verifies that token server-side via `google-auth-library`
  (never trust an identity claimed by the client without verifying it against
  Google's servers), then issues our *own* JWT.
- Why issue our own JWT instead of just trusting Google's token everywhere?
  So the rest of the app doesn't need to know or care how someone logged in —
  every protected route just checks one consistent token format.

### Redis-backed rate limiting
- `express-rate-limit` handles the logic (window, max requests); `rate-limit-redis`
  swaps its storage from in-process memory to Redis.
- **Why Redis matters here specifically:** an in-memory counter is per-server-process.
  Once this app is scaled to multiple instances (see the deferred
  "containerization" section), each instance would have its own separate
  counter, and the *real* limit becomes `instances × max` — the protection
  silently weakens as you scale. Redis gives all instances one shared counter.
- Applied only to `/api/activities` and `/api/recommendations` — the
  endpoints that touch location data and would be attractive to scrape.

**Likely interview question:** *"Why JWT instead of sessions?"* → Sessions
need server-side storage and don't scale horizontally without a shared store
(ironically, you'd need Redis for sessions too). JWTs are stateless and self-contained,
at the cost of being harder to revoke early (can't invalidate one JWT without
a blocklist, since the server doesn't track which tokens are "active").

---

## What was deliberately left out (by your choice)

You chose not to prioritize these — mentioned briefly here so you can still
name-drop them if the interviewer asks about the "full vision":

- **Real-time infra**: Socket.io for live chat/join updates, FCM push notifications.
- **Containerization**: separate Docker containers for Node/Python/frontend, orchestrated with Compose/Kubernetes (note: this repo *does* have a small `docker-compose.yml`, but it's only for the Mongo/Redis infra dependencies, not full app containerization).
- **Gamification**: karma/trust score from upvotes/downvotes.
- **PWA**: offline support, background location sync.

---

## Running it locally

1. `docker compose up -d` (starts MongoDB + Redis)
2. `cd backend-node && cp .env.example .env` (fill in `JWT_SECRET`, and `GOOGLE_CLIENT_ID` if testing Google login) `&& npm install && npm start`
3. `cd backend-ml && pip install -r requirements.txt && python ml_service.py`
4. Open `frontend/index.html` in a browser.
