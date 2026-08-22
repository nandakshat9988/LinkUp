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
- `time` *(String)*: Human-readable scheduled date & time
- `eventDate` *(Date)*: ISO timestamp of scheduled event date & time (drives auto-expiration & chat lifecycle)
- `membersRequired` *(Number)*: Total number of players needed (e.g. 4)
- `contactDetails` *(String)*: Phone, WhatsApp, or Instagram info (revealed only to confirmed players)
- `location` *(GeoJSON Point)*: `[longitude, latitude]`
- `joinRequests` *(Array of User IDs)*: Users waiting for host approval
- `participants` *(Array of User IDs)*: Users confirmed by the host
- `messages` *(Array of Subdocuments)*: Direct messaging stream between host and confirmed players
  - `sender` *(User ID ref)*
  - `text` *(String)*
  - `createdAt` *(Date)*
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
         ├── 💬 Match Team Chat UNLOCKED between Host & Confirmed Players
         │
         ├── Activity appears in player's "🎮 My Confirmed Live Matches" dashboard
         │
         └── If participants.length >= membersRequired:
                 Match marked as "Full", but remains OPEN with active chat until eventDate!
```

---

## 5. Post-Join Team Messaging & Event Lifecycle Auto-Completion

**Files:** `backend-node/routes/activities.js` (`POST /:id/messages`, `GET /:id/messages`, `GET /joined`, `GET /completed`), `frontend/activity.html`, `frontend/app.js`

### 1. Authorization Barrier & Confirmed Live Matches Dashboard
- Only the **host** (`activity.user`) and **confirmed players** (`activity.participants`) have permission to view or post messages in an activity match chat.
- Any request from an unauthenticated user or a non-participant returns **HTTP 403 Forbidden**.
- Confirmed players can access all their upcoming active games at any time from the **🎮 My Confirmed Live Matches** panel on their Dashboard (`GET /api/activities/joined`).

### 2. Time-Based Service Deactivation & Completion Policy
- Every post stores an exact scheduled `eventDate` selected by the host during post creation (`<input type="datetime-local">`).
- **Full Squad Persistence**: Filling the squad (`participants.length >= membersRequired`) does **NOT** prematurely complete the event. The match remains active so that the host and confirmed teammates can coordinate via team chat right up to game time.
- **Auto-Expiration Mechanism**:
  - When the server handles any request (`/api/activities`, `/api/activities/joined`, `/api/activities/nearby`, `/api/activities/:id`, `/api/activities/:id/messages`), it checks if `activity.eventDate <= new Date()`.
  - Once the scheduled event date and time arrives/passes:
    1. The activity is automatically marked with `status: 'completed'` and `completedAt: new Date()`.
    2. The activity moves from the live feeds and joined matches to the **🏁 Completed Events** panel.
    3. The messaging service is **disabled**:
       - Server rejects new message submissions with **HTTP 400 Bad Request** (*"Event date and time has passed. Messaging is disabled for completed events."*).
       - Client UI displays an alert banner (*"🔒 Event time has passed. This event is now completed and the messaging service is disabled."*) and disables input and send buttons.
       - Chat history remains readable for past reference.

### 3. Lightweight, Real-Time Syncing Without Heavy WebSocket Overheads
- To keep the architecture minimal, resilient, and cloud-deployable without separate WebSocket server overhead:
  - Messages are stored directly inside the MongoDB `Activity` document.
  - Active detail views execute a lightweight 4-second REST poll (`GET /api/activities/:id/messages`) while the event is open.
  - Polling automatically stops as soon as the event concludes.

---

## 6. Auth & Security

**Files:** `backend-node/models/User.js`, `backend-node/middleware/auth.js`, `backend-node/middleware/rateLimiter.js`, `backend-node/routes/auth.js`

### Stateless JWT Authentication
- Passwords are salted and hashed using `bcryptjs` (`bcrypt.hash(password, 10)`).
- On login/register, the server signs a JSON Web Token (JWT) containing `{ id, name, email }`.
- The client sends the token in the `Authorization: Bearer <token>` header for all authenticated routes.

### Location Endpoint Rate Limiting
- Endpoints returning location coordinates (`/api/activities`, `/api/recommendations`) are protected by `express-rate-limit`.
- Uses Redis store (`rate-limit-redis`) when `REDIS_URL` is set, and automatically falls back to an in-memory store if Redis is unavailable.

---

## 7. Cloud Deployment Architecture (Render)

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

## 8. Render Deployment Cheat Sheet

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
