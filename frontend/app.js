const NODE_SERVER = 'http://localhost:3000/api';

// ---- Auth state (JWT kept in localStorage so the login survives a refresh) ----
let authToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');

function authHeaders() {
    return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
}

function saveSession(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    renderAuthState();
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    renderAuthState();
}

function renderAuthState() {
    const loggedIn = !!authToken;
    document.getElementById('auth-card').style.display = loggedIn ? 'none' : 'block';
    document.getElementById('app-card').style.display = loggedIn ? 'block' : 'none';
    if (loggedIn) {
        document.getElementById('current-user').innerText = currentUser.name;
        document.getElementById('current-skill').innerText = currentUser.skillLevel || 'beginner';
    }
}

async function register() {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    const res = await fetch(`${NODE_SERVER}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (data.token) {
        saveSession(data.token, data.user);
    } else {
        document.getElementById('auth-status').innerText = data.error || 'Registration failed';
    }
}

async function login() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    const res = await fetch(`${NODE_SERVER}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.token) {
        saveSession(data.token, data.user);
    } else {
        document.getElementById('auth-status').innerText = data.error || 'Login failed';
    }
}

// ---- Posting & feed ----
function postActivity() {
    const activityType = document.getElementById('activityType').value;
    const activity = document.getElementById('activity').value;
    const skillLevel = document.getElementById('skillLevel').value;
    const statusText = document.getElementById('status');

    if (!activityType || !activity) {
        statusText.innerText = "Please fill in all fields.";
        return;
    }

    statusText.innerText = "Getting GPS location...";

    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        const res = await fetch(`${NODE_SERVER}/activities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ activityType, description: activity, skillLevel, lat, lng })
        });

        if (res.ok) {
            statusText.innerText = "Activity posted successfully!";
            loadAllPosts();
        } else {
            const data = await res.json();
            statusText.innerText = data.error || "Failed to post.";
        }
    }, () => {
        statusText.innerText = "Error getting location. Please allow GPS permissions.";
    });
}

async function loadAllPosts() {
    const response = await fetch(`${NODE_SERVER}/activities`);
    const posts = await response.json();

    const list = document.getElementById('posts-list');
    list.innerHTML = "";

    posts.forEach(post => {
        const li = document.createElement('li');
        li.innerText = `${post.user?.name || 'Someone'}: ${post.activityType} — ${post.description} `;
        const joinBtn = document.createElement('button');
        joinBtn.innerText = 'Join';
        joinBtn.onclick = () => joinActivity(post._id);
        li.appendChild(joinBtn);
        list.appendChild(li);
    });
}

async function joinActivity(id) {
    await fetch(`${NODE_SERVER}/activities/${id}/join`, {
        method: 'POST',
        headers: authHeaders()
    });
    loadAllPosts();
}

// ---- Geospatial nearby search (2dsphere index, dynamic radius) ----
function findNearby() {
    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        const res = await fetch(`${NODE_SERVER}/activities/nearby?lat=${lat}&lng=${lng}`);
        const data = await res.json();

        document.getElementById('radius-status').innerText =
            `Search radius auto-set to ${data.radiusKm}km based on local density (${data.count} found).`;

        const list = document.getElementById('nearby-list');
        list.innerHTML = "";
        (data.activities || []).forEach(a => {
            const li = document.createElement('li');
            li.innerText = `${a.activityType} — ${a.description} (${Math.round(a.distanceMeters)}m away)`;
            list.appendChild(li);
        });
    });
}

// ---- Hybrid ML recommendations (geo + collaborative + content/vector) ----
function getRecommendations() {
    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        const response = await fetch(`${NODE_SERVER}/recommendations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ lat, lng })
        });

        const data = await response.json();
        const list = document.getElementById('recommendation-list');
        list.innerHTML = "";

        if (data.recommendations && data.recommendations.length > 0) {
            data.recommendations.forEach(rec => {
                const li = document.createElement('li');
                li.innerText = `${rec.activityType} — ${rec.description} (score: ${rec.score.toFixed(2)})`;
                list.appendChild(li);
            });
        } else {
            list.innerHTML = "<li>No nearby activities found right now.</li>";
        }
    });
}

// ---- Init ----
window.onload = () => {
    renderAuthState();
    loadAllPosts();
};
