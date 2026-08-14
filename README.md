# LinkUp - Activity Sharing & Recommendation App

LinkUp is a location-based social web application where users post sports activities, find nearby players, submit join requests, have hosts confirm participants, and discover matches via a hybrid AI recommendation engine.

Read `STUDY_NOTES.md` for plain-English explanations of the main concepts, architecture, schemas, and deployment notes.

---

## Project Structure

```text
LinkUp/
|-- frontend/                  # Modern Dark Theme HTML/CSS/JS client (served by Express or standalone)
|   |-- index.html             # Landing page with hero, features, workflow, and auth CTAs
|   |-- login.html             # Sign in page
|   |-- register.html          # Sign up page
|   |-- dashboard.html         # Main dashboard (post game, AI suggestions, nearby list, my posts)
|   |-- activity.html          # Dedicated activity details & 2-step join confirmation page
|   |-- style.css              # Cohesive glassmorphism dark design system
|   `-- app.js                 # Auth, geo search, post management, join & host confirmation
|
|-- backend-node/              # Main API server & static frontend host
|   |-- server.js              # Express server (dynamic PORT, static hosting, /api routes)
|   |-- config/db.js           # MongoDB connection with safe logging
|   |-- models/
|   |   |-- User.js            # User authentication model
|   |   `-- Activity.js        # Post, venue, time, capacity, GeoJSON location (2dsphere index)
|   |-- middleware/
|   |   |-- auth.js            # JWT verification middleware
|   |   `-- rateLimiter.js     # Redis rate limiter (with graceful in-memory fallback)
|   |-- routes/
|   |   |-- auth.js            # Register / login / Google OAuth
|   |   |-- activities.js      # Post, feed, nearby, request-join, confirm-participant, complete
|   |   `-- recommendations.js # Hybrid recommendation endpoint (with fallback)
|   `-- utils/geo.js           # Dynamic radius density logic
|
|-- backend-ml/                # Python ML microservice (hybrid recommendation engine)
|   |-- ml_service.py          # TF-IDF + cosine similarity + collaborative scorer
|   `-- requirements.txt
|
|-- package.json               # Root scripts for Render / PaaS deployment
|-- render.yaml                # Render Blueprint (Infrastructure-as-Code)
|-- docker-compose.yml         # MongoDB + Redis for local development
`-- STUDY_NOTES.md             # Complete study notes & deployment guide
```

---

## Local Setup

### 1. Start MongoDB and Redis (Docker):
```bash
docker compose up -d
```

### 2. Start the Node Backend:
```bash
cd backend-node
npm install
npm start
```
*The Express server runs on `http://localhost:3000` and serves both the REST API (`/api/*`) and the frontend UI (`http://localhost:3000`).*

### 3. (Optional) Start Python ML Service:
```bash
cd backend-ml
pip install -r requirements.txt
python ml_service.py
```
*(If the ML microservice is not running, the Node backend automatically uses its built-in proximity fallback algorithm).*

---

## Deploying to Render (Step-by-Step)

You can host LinkUp for free on Render using a single unified Web Service.

### Step 1: Push Code to GitHub
```bash
git add .
git commit -m "Enhance UI and add join confirmation workflow"
git push origin main
```

### Step 2: Create a Free MongoDB Atlas Database
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and create a free shared cluster (M0).
2. Create a Database User (e.g. `linkup_user`) with a strong password.
3. Under **Network Access**, click **Add IP Address** -> select **Allow Access from Anywhere (`0.0.0.0/0`)**.
4. Click **Connect** -> **Drivers** -> copy your connection URI:
   ```text
   mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/linkup?retryWrites=true&w=majority
   ```

### Step 3: Create Web Service on Render
1. Log into your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Web Service**.
3. Choose **Build and deploy from a Git repository** and connect your GitHub account.
4. Select your **LinkUp** repository and click **Connect**.
5. Fill in the fields:

| Field | Value | Notes |
| :--- | :--- | :--- |
| **Name** | `linkup-app` | URL becomes `https://linkup-app.onrender.com` |
| **Runtime** | `Node` | Node.js environment |
| **Build Command** | `npm install && npm run build` | Builds dependencies |
| **Start Command** | `npm start` | Launches Express server |
| **Plan** | `Free` | Free tier |

6. Add Environment Variables (`MONGO_URI`, `JWT_SECRET`, `NODE_ENV=production`).
7. Click **Create Web Service**.
