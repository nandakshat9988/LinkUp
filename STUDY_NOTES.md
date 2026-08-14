# Study Notes — What Changed & Why

This document is a plain-English study guide explaining the core architecture, data schemas, recommendation algorithms, and deployment strategies of LinkUp.

---

## 1. Geospatial Proximity Indexing (MongoDB 2dsphere)

**Files:** `backend-node/models/Activity.js`, `backend-node/utils/geo.js`, `backend-node/routes/activities.js` (`/nearby`)

**The problem it solves:**
If activities are stored without a spatial index, calculating the distance to every post in JavaScript requires scanning every single document (**O(N)** full-table scan). With thousands or millions of active posts, the database server would crash.

**How it is implemented:**
- Activities store their location as a GeoJSON `Point`:
  ```javascript
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: [longitude, latitude] // IMPORTANT: [lng, lat], not [lat, lng]
  }
  ```
- `activitySchema.index({ location: '2dsphere' })` builds a spherical index accounting for Earth's curvature.
- Under the hood, MongoDB uses a hierarchical spatial grid (geohashing) to index coordinates into a B-tree, turning proximity queries into an **O(log N)** tree search.
- The `$geoNear` aggregation pipeline stage calculates exact `distanceMeters` automatically alongside index-accelerated spatial filtering.

---

## 2. Dynamic Radius Adjustment

**File:** `backend-node/utils/geo.js` (`getDynamicRadiusKm`)

**The concept:**
A fixed 5km search radius in a dense metro area returns too many noisy results, while a fixed 5km radius in a suburban or rural area might return zero. LinkUp automatically adjusts the search radius based on local activity density.

**Algorithm:**
1. Execute a lightweight probe query: count activities within a 5km radius of the user's coordinates.
2. Match the count to a density tier:
   - **Dense / Urban (8+ activities):** 2km radius
   - **Medium Density (3–7 activities):** 7km radius
   - **Sparse / Rural (0–2 activities):** 15km radius

---

## 3. Streamlined Hybrid Recommendation Engine

**Files:** `backend-node/routes/recommendations.js`, `backend-ml/ml_service.py`

**Candidate Generation & Ranking Pattern:**
Geo filtering in MongoDB is cheap and index-backed. It filters millions of records down to ~30 nearby candidates. Only this shortlist is sent to Python for scoring.

| Signal | What it measures | Where it is computed |
| :--- | :--- | :--- |
| `geo_score` | Proximity to user (normalized 0–1 against radius) | Node (Mongo `$geoNear`) |
| `collab_score` | Activity types user has engaged with before | Python |
| `content_score` | Semantic text similarity between past activities & post description | Python (`TfidfVectorizer` + `cosine_similarity`) |

**Hybrid Score Formula:**
```text
Score = (0.4 * geo_score) + (0.3 * collab_score) + (0.3 * content_score)
```

**Resilience & Graceful Fallback:**
If the Python ML microservice is offline or unreachable, the Node backend automatically executes `fallbackRecommendations()`, ranking candidate posts by proximity so user experience is never interrupted.

---

## 4. Activity Posts & 2-Step Join Confirmation Workflow

**Files:** `backend-node/models/Activity.js`, `backend-node/routes/activities.js`, `frontend/activity.html`, `frontend/app.js`

### Activity Data Schema
Every activity post includes:
- `activityType` *(String)*: e.g. "Cricket", "Football", "Running"
- `description` *(String)*: Match details & notes
- `venue` *(String)*: Venue or meeting point (e.g. "Decathlon Turf, Sector 62")
- `time` *(String)*: Scheduled date & time (e.g. "Saturday at 6:00 PM")
- `membersRequired` *(Number)*: Total number of players needed (e.g. 4)
- `contactDetails` *(String)*: Phone, WhatsApp, or Instagram info (revealed only to confirmed players)
- `location` *(GeoJSON Point)*: `[longitude, latitude]`
- `joinRequests` *(Array of User IDs)*: Users waiting for host approval
- `participants` *(Array of User IDs)*: Users confirmed by the host
- `status` *(String)*: `'open'` or `'completed'`

### Workflow Flowchart

```
User browses activity
         │
         ▼
Clicks "View & Join" ──► Opens activity.html?id=...
         │
         ▼
Clicks "Confirm & Send Join Request"
         │
         ▼
User added to activity.joinRequests (Status: Pending)
         │
         ▼
Host views pending requests on activity.html or Dashboard
         │
         ▼
Host clicks "Confirm & Add to Match"
         │
         ├── User moved from joinRequests to participants
         │
         ├── Host contact details unlocked & revealed to confirmed user
         │
         └── If participants.length >= membersRequired:
                 Activity status automatically set to "completed"
```

---

## 5. Auth & Security

**Files:** `backend-node/models/User.js`, `backend-node/middleware/auth.js`, `backend-node/middleware/rateLimiter.js`, `backend-node/routes/auth.js`

### Stateless JWT Authentication
- Passwords are salted and hashed using `bcryptjs` (`bcrypt.hash(password, 10)`).
- On login/register, the server signs a JSON Web Token (JWT) containing `{ id, name, email }`.
- The client sends the token in the `Authorization: Bearer <token>` header for all authenticated routes.

### Location Endpoint Rate Limiting
- Endpoints returning location coordinates (`/api/activities`, `/api/recommendations`) are protected by `express-rate-limit`.
- Uses Redis store (`rate-limit-redis`) when `REDIS_URL` is set, and automatically falls back to an in-memory store if Redis is unavailable.

---

## 6. Cloud Deployment Architecture (Render)

**Files:** `backend-node/server.js`, `frontend/app.js`, `package.json`, `render.yaml`

### Unified Web Service Model
Express handles both the REST API and the static frontend assets:
1. **API Endpoints:** `/api/auth`, `/api/activities`, `/api/recommendations`, `/api/health`
2. **Static Assets:** `frontend/` (`index.html`, `login.html`, `register.html`, `dashboard.html`, `activity.html`, `style.css`, `app.js`)

**Key Advantages:**
- **Zero CORS Configuration:** Frontend and API share the exact same origin.
- **Single Free Service:** Runs on 1 single free Web Service on Render.
- **Dynamic Port Binding:** Express dynamically listens on `process.env.PORT || 3000`.

---

## 7. Render Deployment Cheat Sheet

When creating a new Web Service in the Render Dashboard:

| Setting | Recommended Value | Explanation |
| :--- | :--- | :--- |
| **Repository** | `your-username/LinkUp` | Connect your GitHub repository |
| **Name** | `linkup-app` | Yields `https://linkup-app.onrender.com` |
| **Runtime** | `Node` | Node.js runtime |
| **Build Command** | `npm install && npm run build` | Builds dependencies |
| **Start Command** | `npm start` | Launches `node backend-node/server.js` |
| **Plan** | `Free` | $0/month free tier |

### Environment Variables

| Variable | Value | Purpose |
| :--- | :--- | :--- |
| `MONGO_URI` | `mongodb+srv://<user>:<pwd>@cluster.mongodb.net/linkup?retryWrites=true&w=majority` | Connects to MongoDB Atlas |
| `JWT_SECRET` | 32+ character random string | Signs authentication tokens |
| `NODE_ENV` | `production` | Optimizes Express performance |
| `REDIS_URL` | *(Optional)* Upstash or Redis URL | If omitted, in-memory rate limiting is used |
| `GOOGLE_CLIENT_ID` | *(Optional)* Google OAuth Client ID | Required only if testing Google Sign-in |
| `ML_SERVICE_URL` | *(Optional)* Python ML microservice URL | If omitted, fallback recommender is used |
