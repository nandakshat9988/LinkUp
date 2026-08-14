# Study Notes — What Changed & Why

This doc is a plain-English cheat sheet explaining the core architecture, mechanisms, and deployment strategies of LinkUp.

---

## 1. Geospatial Indexing (MongoDB 2dsphere)

**Files:** `backend-node/models/Activity.js`, `backend-node/utils/geo.js`, `backend-node/routes/activities.js` (`/nearby`), `backend-node/routes/recommendations.js`

**The problem it solves:** keeping posts in a JS array and scanning every post to compute distances is an **O(N)** operation. At scale (thousands or millions of posts), full-table scans grind the database to a halt.

**The fix:**
- Activities store `location` as a GeoJSON `Point`: `{ type: 'Point', coordinates: [lng, lat] }`.
  **Order matters — it's `[longitude, latitude]`, the opposite of standard conversational order.**
- `activitySchema.index({ location: '2dsphere' })` builds a spherical index that accounts for Earth's curvature.
- Under the hood, MongoDB's 2dsphere index uses a hierarchical spatial grid (geohashing) so nearby points share common prefix keys in a B-tree. This transforms proximity search into an **O(log N)** index traversal.
- `$geoNear` (aggregation stage) is used because it calculates `distanceField` (meters from the user) automatically alongside index-accelerated filtering.

---

## 2. Dynamic Radius Adjustment

**File:** `backend-node/utils/geo.js` (`getDynamicRadiusKm`)

**The concept:** a 5km search radius in a dense metro area might return too many noisy results, while a 5km radius in a suburban or rural area might return zero. The search radius adapts based on local activity density.

**Implementation:**
1. Execute a lightweight probe query: count activities within a 5km radius of the user's coordinates.
2. Map count to a density tier:
   - **Dense (8+ activities):** 2km radius
   - **Medium (3-7 activities):** 7km radius
   - **Sparse (0-2 activities):** 15km radius

---

## 3. Hybrid Recommendation Engine

**Files:** `backend-node/routes/recommendations.js` (Node API), `backend-ml/ml_service.py` (Python ML microservice)

**Architecture Pattern — Candidate Generation & Ranking:**
Geo filtering is cheap and index-backed in MongoDB/Node. It filters millions of records down to ~30 nearby candidates. Only this shortlist is sent to Python for scoring.

| Signal | What it measures | Where it's computed |
| :--- | :--- | :--- |
| `geo_score` | Proximity to user (normalized 0-1 against radius) | Node (Mongo `$geoNear`) |
| `collab_score` | Activity types user has engaged with before | Python |
| `content_score` | Text similarity between past activities & candidate description | Python (`TfidfVectorizer` + `cosine_similarity`) |
| `skill_bonus` | Matching user's skill level (beginner/intermediate/advanced) | Python / Node fallback |

**Combined Score Formula:**
`Score = (0.4 * geo) + (0.3 * collab) + (0.3 * content) + skill_bonus`

**Resilience & Graceful Fallback:**
If the Python microservice is offline or not deployed, Node automatically executes `fallbackRecommendations()`, ranking by distance and skill level so user experience is never interrupted.

---

## 4. Auth & Security

**Files:** `backend-node/models/User.js`, `backend-node/middleware/auth.js`, `backend-node/middleware/rateLimiter.js`, `backend-node/routes/auth.js`

### JWT (JSON Web Tokens)
- Stateless authentication: user ID, name, and email are signed with `JWT_SECRET`.
- Sent via `Authorization: Bearer <token>`.
- Passwords are salted and hashed using `bcryptjs` (`bcrypt.hash(password, 10)`).

### Rate Limiting & Graceful Store Fallback
- Protected endpoints: `/api/activities` and `/api/recommendations` (prevents scraping coordinate data).
- Uses `express-rate-limit` with `rate-limit-redis`.
- **Graceful Fallback:** If `REDIS_URL` is omitted (e.g. on free cloud hosting), it automatically uses in-memory tracking without throwing exceptions or blocking requests.

---

## 5. Cloud Deployment Architecture (Render)

**Files:** `backend-node/server.js`, `frontend/app.js`, `package.json`, `render.yaml`

### Unified Web Service Model
Instead of deploying frontend and backend as separate services, Express serves both:
1. **API Endpoints:** `/api/auth`, `/api/activities`, `/api/recommendations`, `/api/health`
2. **Static Assets:** `frontend/` (`index.html`, `dashboard.html`, `style.css`, `app.js`)

**Benefits:**
- **Zero CORS Configuration:** Requests to `/api/*` run on the exact same origin.
- **Cost Effective:** Requires only 1 single free Web Service on Render.
- **Dynamic Port Binding:** Express dynamically listens on `process.env.PORT || 3000`.
- **Dynamic API Base:** `frontend/app.js` checks environment: uses `/api` in production and `http://localhost:3000/api` when testing standalone files.

---

## 6. Render Web Service Configuration Cheat Sheet

When creating a new Web Service in the Render Dashboard:

| Section | Setting / Value | Explanation |
| :--- | :--- | :--- |
| **Repository** | `your-username/LinkUp` | Connect your GitHub repository |
| **Name** | `linkup-app` | URL becomes `https://linkup-app.onrender.com` |
| **Region** | Oregon (US West) / Singapore / Frankfurt | Choose closest to your users |
| **Branch** | `main` (or `master`) | Branch to deploy from |
| **Root Directory** | *(Leave blank)* or `backend-node` | Root `package.json` coordinates subfolder builds |
| **Runtime** | `Node` | Node.js environment |
| **Build Command** | `npm install && npm run build` | Installs root & backend-node dependencies |
| **Start Command** | `npm start` | Runs `node backend-node/server.js` |
| **Plan** | `Free` | $0/month free tier |

### Environment Variables

| Variable | Value | Purpose |
| :--- | :--- | :--- |
| `MONGO_URI` | `mongodb+srv://<user>:<pwd>@cluster.mongodb.net/linkup?retryWrites=true&w=majority` | Connects to MongoDB Atlas |
| `JWT_SECRET` | 32+ character random string | Signs authentication tokens |
| `NODE_ENV` | `production` | Optimizes Express performance |
| `REDIS_URL` | *(Optional)* Upstash or Render Redis URL | If omitted, in-memory rate limiting is used |
| `GOOGLE_CLIENT_ID` | *(Optional)* Google OAuth Client ID | Required only if testing Google Sign-in |
| `ML_SERVICE_URL` | *(Optional)* Python ML microservice URL | If omitted, fallback recommender is used |
