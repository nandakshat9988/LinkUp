# LinkUp - Activity Sharing & Recommendation App

LinkUp is a location-based social app where users post activities, find nearby people, join posts, and get suggested activities from a hybrid recommendation engine.

Read `STUDY_NOTES.md` for plain-English explanations of the main concepts, architecture, and deployment notes.

---

## Project Structure

```text
LinkUp/
|-- frontend/                  # Plain HTML/CSS/JS client (served by Express or standalone)
|   |-- index.html             # Redirects to login or dashboard
|   |-- login.html             # Login page
|   |-- register.html          # Register page
|   |-- dashboard.html         # Main app dashboard
|   |-- style.css
|   `-- app.js                 # Auth, posting, joining, geo search, recommendations
|
|-- backend-node/              # Main API server & static frontend host
|   |-- server.js              # Express app (dynamic PORT, static hosting, /api routes)
|   |-- config/db.js           # MongoDB connection with safe logging
|   |-- models/
|   |   |-- User.js            # Auth + skill level
|   |   `-- Activity.js        # Posts, status, participants, GeoJSON location (2dsphere index)
|   |-- middleware/
|   |   |-- auth.js            # JWT verification
|   |   `-- rateLimiter.js     # Redis rate limiter (graceful in-memory fallback)
|   |-- routes/
|   |   |-- auth.js            # Register / login / Google OAuth
|   |   |-- activities.js      # Feed, post, nearby, join, edit, delete, complete
|   |   `-- recommendations.js # Hybrid recommendation endpoint (with fallback)
|   `-- utils/geo.js           # Dynamic radius logic
|
|-- backend-ml/                # Python ML microservice (optional hybrid scorer)
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
*The Express server runs on `http://localhost:3000` and automatically serves both the API (`/api/*`) and the frontend UI (`http://localhost:3000`).*

### 3. (Optional) Start Python ML Service:
```bash
cd backend-ml
pip install -r requirements.txt
python ml_service.py
```
*(If the ML microservice is not started, the Node backend seamlessly uses its built-in fallback algorithm).*

---

## Deploying to Render (Step-by-Step)

You can host LinkUp for free on Render using a single unified Web Service.

### Step 1: Push Code to GitHub
```bash
git add .
git commit -m "Configure project for Render deployment"
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
| **Name** | `linkup-app` | Or any unique name you choose |
| **Language / Runtime** | `Node` | Detected automatically |
| **Branch** | `main` | Or `master` |
| **Root Directory** | *(Leave blank)* or `backend-node` | Both work with root scripts |
| **Build Command** | `npm install && npm run build` | Or `npm install` if root dir is `backend-node` |
| **Start Command** | `npm start` | Runs `node backend-node/server.js` |
| **Instance Type** | `Free` | Free tier |

### Step 4: Add Environment Variables in Render
Scroll down to the **Environment Variables** section and click **Add Environment Variable**:

1. **`MONGO_URI`** = `mongodb+srv://<user>:<password>@cluster.mongodb.net/linkup?retryWrites=true&w=majority`
2. **`JWT_SECRET`** = `any-secure-random-32-char-string-here`
3. **`NODE_ENV`** = `production`
4. *(Optional)* **`REDIS_URL`** = If you have a Redis instance (Upstash or Render). If left empty, LinkUp automatically uses fast in-memory rate limiting.
5. *(Optional)* **`GOOGLE_CLIENT_ID`** = Your Google OAuth client ID (if using Google Login).
6. *(Optional)* **`ML_SERVICE_URL`** = URL of Python ML service if deployed separately. If omitted, built-in fallback recommendation engine is used.

### Step 5: Deploy
Click **Create Web Service**. Render will install dependencies, build the app, and provide a live URL (e.g., `https://linkup-app.onrender.com`).

Visit your live URL to use the app!
