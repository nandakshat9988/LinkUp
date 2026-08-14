# LinkUp - Activity Sharing & Recommendation App

LinkUp is a location-based social app where users post activities, find nearby
people, join posts, and get suggested activities from a hybrid recommendation
engine.

Read `STUDY_NOTES.md` for the plain-English explanation of the main concepts.

## Project Structure

```text
LinkUp/
|
|-- frontend/                  # Plain HTML/CSS/JS client
|   |-- index.html             # Redirects to login or dashboard
|   |-- login.html             # Login page
|   |-- register.html          # Register page
|   |-- dashboard.html         # Main app dashboard
|   |-- style.css
|   `-- app.js                 # Auth, posting, joining, geo search, recommendations
|
|-- backend-node/              # Main API server
|   |-- server.js
|   |-- config/db.js           # MongoDB connection
|   |-- models/
|   |   |-- User.js            # Auth + skill level
|   |   `-- Activity.js        # Posts, status, participants, GeoJSON location
|   |-- middleware/
|   |   |-- auth.js            # JWT verification
|   |   `-- rateLimiter.js     # Redis-backed rate limiting
|   |-- routes/
|   |   |-- auth.js            # Register / login / Google OAuth
|   |   |-- activities.js      # Feed, post, nearby, join, edit, delete, complete
|   |   `-- recommendations.js # Hybrid recommendation endpoint
|   `-- utils/geo.js           # Dynamic radius logic
|
|-- backend-ml/                # Python ML microservice
|   |-- ml_service.py          # Hybrid scorer
|   `-- requirements.txt
|
|-- docker-compose.yml         # MongoDB + Redis for local development
`-- STUDY_NOTES.md             # Study notes
```

## Setup

1. Start MongoDB and Redis:
   ```bash
   docker compose up -d
   ```

2. Start the Node backend:
   ```bash
   cd backend-node
   npm install
   npm start
   ```

3. Start the Python ML service:
   ```bash
   cd backend-ml
   pip install -r requirements.txt
   python ml_service.py
   ```

4. Open the frontend:
   ```text
   frontend/index.html
   ```

## Main Pages

- `login.html`: existing users log in.
- `register.html`: new users create an account and choose a skill level.
- `dashboard.html`: users post activities, see suggestions, search nearby posts,
  view recent posts, join posts, and manage their own posts.
