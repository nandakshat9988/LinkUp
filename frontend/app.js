// LinkUp Client-Side Logic
const NODE_SERVER = window.API_BASE_URL || (
    window.location.protocol === 'file:' || (window.location.hostname === 'localhost' && window.location.port && window.location.port !== '3000')
        ? 'http://localhost:3000/api'
        : '/api'
);

let authToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');

// DOM Helpers
function el(id) {
    return document.getElementById(id);
}

function value(id) {
    const node = el(id);
    return node ? node.value.trim() : '';
}

function showStatus(elementId, message, type = 'info') {
    const node = el(elementId);
    if (!node) return;
    node.className = `status-message show ${type}`;
    node.innerText = message;
}

function hideStatus(elementId) {
    const node = el(elementId);
    if (!node) return;
    node.className = 'status-message';
    node.innerText = '';
}

function authHeaders(hasBody = false) {
    const headers = {};
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return headers;
}

async function sendRequest(path, options = {}) {
    const response = await fetch(`${NODE_SERVER}${path}`, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }

    return data;
}

function saveSession(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    authToken = null;
    currentUser = null;
    window.location.href = 'login.html';
}

function requireLogin() {
    if (!authToken) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

/* ============================================================
   AUTH: REGISTER & LOGIN
   ============================================================ */
async function register(event) {
    event.preventDefault();
    showStatus('register-status', 'Creating your account...', 'info');

    const body = {
        name: value('register-name'),
        email: value('register-email'),
        password: value('register-password')
    };

    try {
        const data = await sendRequest('/auth/register', {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify(body)
        });

        saveSession(data.token, data.user);
        showStatus('register-status', 'Account created! Redirecting...', 'success');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
    } catch (err) {
        showStatus('register-status', err.message || 'Registration failed', 'error');
    }
}

async function login(event) {
    event.preventDefault();
    showStatus('login-status', 'Signing in...', 'info');

    const body = {
        email: value('login-email'),
        password: value('login-password')
    };

    try {
        const data = await sendRequest('/auth/login', {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify(body)
        });

        saveSession(data.token, data.user);
        showStatus('login-status', 'Success! Opening dashboard...', 'success');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
    } catch (err) {
        showStatus('login-status', err.message || 'Login failed. Check your email or password.', 'error');
    }
}

/* ============================================================
   DASHBOARD INITIALIZATION & POSTING
   ============================================================ */
function startDashboard() {
    if (!requireLogin()) return;
    if (!currentUser) {
        logout();
        return;
    }

    if (el('current-user')) el('current-user').innerText = currentUser.name;
    if (el('current-email')) el('current-email').innerText = currentUser.email;
    if (el('user-avatar-initial')) el('user-avatar-initial').innerText = (currentUser.name || 'U')[0].toUpperCase();

    // Set default min for event datetime picker to current time
    const dtInput = el('activity-event-datetime');
    if (dtInput) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dtInput.min = now.toISOString().slice(0, 16);
    }

    loadAllPosts();
    loadMyPosts();
    loadCompletedPosts();
}

function postActivity(event) {
    event.preventDefault();
    if (!requireLogin()) return;

    const eventDateVal = value('activity-event-datetime');
    if (!eventDateVal) {
        showStatus('post-status', 'Please select a valid event date and time.', 'error');
        return;
    }

    showStatus('post-status', 'Detecting your location for accurate proximity matching...', 'info');

    if (!navigator.geolocation) {
        showStatus('post-status', 'Geolocation is not supported by your browser.', 'error');
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const eventDateObj = new Date(eventDateVal);
        const displayTime = eventDateObj.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        const body = {
            activityType: value('activity-type'),
            membersRequired: parseInt(value('activity-members'), 10) || 1,
            venue: value('activity-venue'),
            time: displayTime,
            eventDate: eventDateObj.toISOString(),
            contactDetails: value('activity-contact'),
            description: value('activity-description'),
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        try {
            await sendRequest('/activities', {
                method: 'POST',
                headers: authHeaders(true),
                body: JSON.stringify(body)
            });

            event.target.reset();
            showStatus('post-status', 'Activity posted successfully!', 'success');
            setTimeout(() => hideStatus('post-status'), 4000);

            loadAllPosts();
            loadMyPosts();
            loadCompletedPosts();
        } catch (err) {
            showStatus('post-status', err.message, 'error');
        }
    }, (geoErr) => {
        showStatus('post-status', `Location error: ${geoErr.message}. Please allow location access.`, 'error');
    });
}

/* ============================================================
   FEEDS & CARD RENDERING
   ============================================================ */
async function loadAllPosts() {
    const list = el('posts-list');
    if (!list) return;

    try {
        const posts = await sendRequest('/activities');
        list.innerHTML = '';

        if (!posts || posts.length === 0) {
            list.innerHTML = '<li class="empty-state-box">No open upcoming activities right now. Be the first to post!</li>';
            return;
        }

        posts.forEach(post => list.appendChild(makeActivityCard(post, 'recent')));
    } catch (err) {
        list.innerHTML = `<li class="empty-state-box" style="color: var(--accent-rose);">Failed to load posts: ${err.message}</li>`;
    }
}

async function loadCompletedPosts() {
    const list = el('completed-posts-list');
    if (!list) return;

    try {
        const posts = await sendRequest('/activities/completed');
        list.innerHTML = '';

        if (!posts || posts.length === 0) {
            list.innerHTML = '<li class="empty-state-box">No completed or past events yet.</li>';
            return;
        }

        posts.forEach(post => list.appendChild(makeActivityCard(post, 'completed')));
    } catch (err) {
        list.innerHTML = `<li class="empty-state-box" style="color: var(--accent-rose);">Failed to load completed events: ${err.message}</li>`;
    }
}

function findNearby() {
    const list = el('nearby-list');
    if (!list) return;

    showStatus('radius-status', 'Getting your location...', 'info');

    if (!navigator.geolocation) {
        showStatus('radius-status', 'Geolocation not supported', 'error');
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        try {
            const data = await sendRequest(`/activities/nearby?lat=${lat}&lng=${lng}`);
            list.innerHTML = '';

            showStatus('radius-status', `Dynamic search radius: ${data.radiusKm} km. Found ${data.count} nearby upcoming matches.`, 'info');

            if (!data.activities || data.activities.length === 0) {
                list.innerHTML = '<li class="empty-state-box">No nearby activities found within your area.</li>';
                return;
            }

            data.activities.forEach(post => list.appendChild(makeActivityCard(post, 'nearby')));
        } catch (err) {
            showStatus('radius-status', err.message, 'error');
        }
    }, (geoErr) => {
        showStatus('radius-status', `Location access denied: ${geoErr.message}`, 'error');
    });
}

function getRecommendations() {
    if (!requireLogin()) return;
    const list = el('recommendation-list');
    if (!list) return;

    list.innerHTML = '<li class="empty-state-box">Locating and running hybrid recommendation scoring...</li>';

    navigator.geolocation.getCurrentPosition(async (position) => {
        const body = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        try {
            const data = await sendRequest('/recommendations', {
                method: 'POST',
                headers: authHeaders(true),
                body: JSON.stringify(body)
            });

            list.innerHTML = '';

            if (!data.recommendations || data.recommendations.length === 0) {
                list.innerHTML = '<li class="empty-state-box">No recommendations right now. Try posting or joining matches to build history!</li>';
                return;
            }

            data.recommendations.forEach(post => list.appendChild(makeActivityCard(post, 'suggested')));
        } catch (err) {
            list.innerHTML = `<li class="empty-state-box" style="color: var(--accent-rose);">${err.message}</li>`;
        }
    }, () => {
        list.innerHTML = '<li class="empty-state-box" style="color: var(--accent-rose);">Please allow location access to get recommendations.</li>';
    });
}

async function loadMyPosts() {
    if (!requireLogin()) return;
    const list = el('my-posts-list');
    if (!list) return;

    try {
        const posts = await sendRequest('/activities/mine', {
            headers: authHeaders()
        });

        list.innerHTML = '';

        if (!posts || posts.length === 0) {
            list.innerHTML = '<li class="empty-state-box">You haven\'t posted any activities yet.</li>';
            return;
        }

        posts.forEach(post => list.appendChild(makeMyPostCard(post)));
    } catch (err) {
        showStatus('my-posts-status', err.message, 'error');
    }
}

/* ============================================================
   CARD BUILDERS
   ============================================================ */
function makeActivityCard(post, source) {
    const item = document.createElement('li');
    item.className = 'activity-card';

    const id = post._id || post.id;
    const isPast = post.eventDate && new Date(post.eventDate) <= new Date();
    const status = isPast ? 'completed' : (post.status || 'open');
    const hostName = post.user?.name || 'Community Member';
    const participantsCount = post.participants ? post.participants.length : 0;
    const totalRequired = post.membersRequired || 1;
    const venue = post.venue || 'Local Spot';
    const time = post.time || (post.eventDate ? new Date(post.eventDate).toLocaleString() : 'Flexible');

    let extraPill = '';
    if (source === 'nearby') {
        const meters = Math.round(post.distanceMeters || 0);
        extraPill = `<span class="meta-pill score">⚡ ${meters < 1000 ? meters + ' m' : (meters/1000).toFixed(1) + ' km'} away</span>`;
    } else if (source === 'suggested') {
        const score = post.score ? post.score.toFixed(2) : '0.00';
        extraPill = `<span class="meta-pill score">🧠 AI Score: ${score}</span>`;
    } else if (source === 'completed' || isPast) {
        extraPill = `<span class="meta-pill" style="color: var(--text-muted); background: rgba(255,255,255,0.05);">🏁 Concluded</span>`;
    }

    item.innerHTML = `
        <div class="activity-card-top">
            <div>
                <span class="status-pill ${status}">${status}</span>
                <h3 class="activity-badge-title" style="margin-top: 6px;">${post.activityType}</h3>
            </div>
            <span class="meta-pill capacity">👥 ${participantsCount} / ${totalRequired} Joined</span>
        </div>

        <p class="activity-desc-text">${post.description}</p>

        <div class="activity-meta-pills">
            <span class="meta-pill venue">📍 ${venue}</span>
            <span class="meta-pill time">⏰ ${time}</span>
            ${extraPill}
        </div>

        <div class="activity-card-bottom">
            <span class="host-tag">Posted by <strong>${hostName}</strong></span>
            <a href="activity.html?id=${id}" class="btn btn-primary btn-sm">
                ${status === 'completed' ? 'View Match & History →' : 'View & Join →'}
            </a>
        </div>
    `;

    return item;
}

function makeMyPostCard(post) {
    const item = document.createElement('li');
    item.className = 'activity-card';
    const id = post._id || post.id;
    const isPast = post.eventDate && new Date(post.eventDate) <= new Date();
    const status = isPast ? 'completed' : (post.status || 'open');
    const pendingCount = post.joinRequests ? post.joinRequests.length : 0;
    const confirmedCount = post.participants ? post.participants.length : 0;
    const totalRequired = post.membersRequired || 1;
    const time = post.time || (post.eventDate ? new Date(post.eventDate).toLocaleString() : 'Time not set');

    item.innerHTML = `
        <div class="activity-card-top">
            <div>
                <span class="status-pill ${status}">${status}</span>
                <h3 class="activity-badge-title" style="margin-top: 6px;">${post.activityType}</h3>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                ${pendingCount > 0 && status !== 'completed' ? `<span class="meta-pill" style="background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.35); color: #fbbf24;">🔔 ${pendingCount} Join Request${pendingCount > 1 ? 's' : ''}</span>` : ''}
                <span class="meta-pill capacity">👥 ${confirmedCount} / ${totalRequired} Confirmed</span>
            </div>
        </div>

        <p class="activity-desc-text">${post.description}</p>

        <div class="activity-meta-pills">
            <span class="meta-pill venue">📍 ${post.venue || 'Venue not set'}</span>
            <span class="meta-pill time">⏰ ${time}</span>
        </div>

        <div class="activity-card-bottom" style="flex-wrap: wrap;">
            <a href="activity.html?id=${id}" class="btn btn-primary btn-sm">
                ${status === 'completed' ? 'View Details & Chat History →' : `Manage Match & Chat (${confirmedCount} Joined) →`}
            </a>
            <div style="display: flex; gap: 8px;">
                ${status !== 'completed' ? `<button class="btn btn-secondary btn-sm" onclick="completePost('${id}')">Mark Complete</button>` : ''}
                <button class="btn btn-danger btn-sm" onclick="deletePost('${id}')">Delete</button>
            </div>
        </div>
    `;

    return item;
}

async function completePost(id) {
    try {
        await sendRequest(`/activities/${id}/complete`, {
            method: 'PATCH',
            headers: authHeaders()
        });
        showStatus('my-posts-status', 'Activity marked as completed.', 'success');
        loadAllPosts();
        loadMyPosts();
        loadCompletedPosts();
    } catch (err) {
        showStatus('my-posts-status', err.message, 'error');
    }
}

async function deletePost(id) {
    if (!confirm('Are you sure you want to delete this activity post?')) return;

    try {
        await sendRequest(`/activities/${id}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        showStatus('my-posts-status', 'Activity post deleted.', 'info');
        loadAllPosts();
        loadMyPosts();
        loadCompletedPosts();
    } catch (err) {
        showStatus('my-posts-status', err.message, 'error');
    }
}

/* ============================================================
   SINGLE ACTIVITY DETAILS, JOIN & CHAT PAGE (ACTIVITY.HTML)
   ============================================================ */
let activeChatActivityId = null;
let chatPollingInterval = null;

async function loadActivityDetailPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const activityId = urlParams.get('id');

    if (!activityId) {
        if (el('detail-description')) {
            el('detail-description').innerText = 'Error: No activity ID provided in URL.';
        }
        return;
    }

    activeChatActivityId = activityId;

    try {
        const activity = await sendRequest(`/activities/${activityId}`);
        renderActivityDetails(activity);
    } catch (err) {
        if (el('detail-description')) {
            el('detail-description').innerText = `Error loading activity: ${err.message}`;
        }
    }
}

function renderActivityDetails(activity) {
    const id = activity._id;
    const host = activity.user || {};
    const hostId = host._id || host.id || host;
    const isHost = currentUser && hostId.toString() === currentUser.id;
    const isConfirmed = currentUser && (activity.participants || []).some(p => (p._id || p).toString() === currentUser.id);
    const isRequested = currentUser && (activity.joinRequests || []).some(r => (r._id || r).toString() === currentUser.id);

    const isPast = activity.eventDate && new Date(activity.eventDate) <= new Date();
    const isConcluded = isPast || activity.status === 'completed';
    const displayStatus = isConcluded ? 'completed' : (activity.status || 'open');

    const confirmedCount = (activity.participants || []).length;
    const totalRequired = activity.membersRequired || 1;
    const percentCapacity = Math.min(100, Math.round((confirmedCount / totalRequired) * 100));

    // Populate basic info
    if (el('detail-activity-type')) el('detail-activity-type').innerText = activity.activityType;
    if (el('detail-status-pill')) {
        el('detail-status-pill').className = `status-pill ${displayStatus}`;
        el('detail-status-pill').innerText = displayStatus;
    }
    if (el('detail-description')) el('detail-description').innerText = activity.description;
    if (el('detail-venue')) el('detail-venue').innerText = activity.venue || 'Not specified';
    if (el('detail-time')) el('detail-time').innerText = activity.time || (activity.eventDate ? new Date(activity.eventDate).toLocaleString() : 'Not specified');
    if (el('detail-host-name')) el('detail-host-name').innerText = host.name || 'Community Member';
    if (el('detail-host-badge')) el('detail-host-badge').innerText = `Host: ${host.name || 'Host'}`;
    if (el('detail-capacity')) el('detail-capacity').innerText = `${confirmedCount} / ${totalRequired} Players Confirmed`;
    if (el('detail-capacity-bar')) el('detail-capacity-bar').style.width = `${percentCapacity}%`;

    const heading = el('action-heading');
    const desc = el('action-description');
    const buttonsGroup = el('action-buttons-group');
    const hostContainer = el('host-management-container');
    const contactBox = el('confirmed-contact-box');
    const chatContainer = el('activity-chat-container');

    buttonsGroup.innerHTML = '';

    // If viewer is the HOST
    if (isHost) {
        heading.innerText = 'You are the Host of this Activity';
        desc.innerText = 'Review join requests from other players below and confirm participants to fill your match.';

        if (!isConcluded) {
            const completeBtn = document.createElement('button');
            completeBtn.className = 'btn btn-secondary btn-sm';
            completeBtn.innerText = 'Mark Activity as Completed';
            completeBtn.onclick = async () => {
                await sendRequest(`/activities/${id}/complete`, { method: 'PATCH', headers: authHeaders() });
                loadActivityDetailPage();
            };
            buttonsGroup.appendChild(completeBtn);
        }

        // Render pending requests list for host
        hostContainer.style.display = 'block';
        const reqList = el('host-requests-list');
        const partList = el('host-participants-list');

        reqList.innerHTML = '';
        if (activity.joinRequests && activity.joinRequests.length > 0 && !isConcluded) {
            activity.joinRequests.forEach(reqUser => {
                const reqItem = document.createElement('div');
                reqItem.className = 'user-request-item';
                reqItem.innerHTML = `
                    <div class="user-request-info">
                        <strong>${reqUser.name || 'Player'}</strong>
                        <small>${reqUser.email || ''}</small>
                    </div>
                    <button class="btn btn-success btn-sm" onclick="confirmParticipant('${id}', '${reqUser._id}')">
                        ✅ Confirm & Add to Match
                    </button>
                `;
                reqList.appendChild(reqItem);
            });
        } else {
            reqList.innerHTML = '<p class="form-hint">No pending join requests right now.</p>';
        }

        // Render confirmed participants for host
        partList.innerHTML = '';
        if (activity.participants && activity.participants.length > 0) {
            activity.participants.forEach(pUser => {
                const pItem = document.createElement('div');
                pItem.className = 'user-request-item';
                pItem.innerHTML = `
                    <div class="user-request-info">
                        <strong>${pUser.name || 'Player'}</strong>
                        <small>${pUser.email || ''}</small>
                    </div>
                    <span class="status-pill open">Confirmed</span>
                `;
                partList.appendChild(pItem);
            });
        } else {
            partList.innerHTML = '<p class="form-hint">No confirmed players yet.</p>';
        }

        // Setup Chat Section for Host
        setupChatSection(activity, true, isConcluded, hostId);
        return;
    }

    // If viewer is NOT the host
    hostContainer.style.display = 'none';

    if (!authToken) {
        heading.innerText = 'Want to join this match?';
        desc.innerText = 'Please sign in or create an account to view host details, send join requests, and chat.';
        buttonsGroup.innerHTML = `<a href="login.html" class="btn btn-primary">Login to Join</a>`;
        if (chatContainer) chatContainer.style.display = 'none';
        return;
    }

    if (isConfirmed) {
        heading.innerText = 'You are in!';
        desc.innerText = 'The host has confirmed your spot in this match. Connect with them and teammates below:';
        contactBox.style.display = 'block';
        el('revealed-contact-text').innerHTML = `
            <strong>Host Name:</strong> ${host.name || 'Host'}<br>
            <strong>Host Email:</strong> ${host.email || 'None'}<br>
            <strong>Contact Info / Instructions:</strong> ${activity.contactDetails || 'No additional contact notes provided.'}
        `;

        // Setup Chat Section for Confirmed Participant
        setupChatSection(activity, false, isConcluded, hostId);
        return;
    }

    if (chatContainer) chatContainer.style.display = 'none';

    if (isRequested) {
        heading.innerText = 'Join Request Pending';
        desc.innerText = `You have submitted a join request. Once ${host.name || 'the host'} confirms your request, your spot will be secured, host contact will be revealed, and team chat will be unlocked.`;
        buttonsGroup.innerHTML = `<button class="btn btn-secondary" disabled>⏳ Awaiting Host Confirmation</button>`;
        return;
    }

    if (isConcluded || confirmedCount >= totalRequired) {
        heading.innerText = isPast ? 'Event Concluded' : 'Activity Full / Completed';
        desc.innerText = isPast ? 'The scheduled date and time for this match has passed.' : 'All member slots for this activity have been filled.';
        buttonsGroup.innerHTML = `<button class="btn btn-secondary" disabled>Match Completed</button>`;
        return;
    }

    // Default: Open for request
    heading.innerText = 'Request to Join this Activity';
    desc.innerText = `You are requesting to join ${activity.activityType} hosted by ${host.name || 'a member'}. The host will review and confirm your spot.`;

    const joinBtn = document.createElement('button');
    joinBtn.className = 'btn btn-primary btn-lg';
    joinBtn.id = 'confirm-join-btn';
    joinBtn.innerText = '🤝 Confirm & Send Join Request';
    joinBtn.onclick = () => submitJoinRequest(id);
    buttonsGroup.appendChild(joinBtn);
}

/* ============================================================
   MATCH MESSAGING & CHAT IMPLEMENTATION
   ============================================================ */
function setupChatSection(activity, isHost, isConcluded, hostId) {
    const chatContainer = el('activity-chat-container');
    if (!chatContainer) return;

    chatContainer.style.display = 'block';

    const disabledBanner = el('chat-disabled-banner');
    const liveBadge = el('chat-live-badge');
    const msgInput = el('chat-message-input');
    const sendBtn = el('chat-send-btn');

    if (isConcluded) {
        if (disabledBanner) disabledBanner.style.display = 'flex';
        if (liveBadge) {
            liveBadge.innerText = '🔒 Session Concluded';
            liveBadge.style.color = 'var(--text-muted)';
            liveBadge.style.background = 'rgba(255, 255, 255, 0.05)';
            liveBadge.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }
        if (msgInput) msgInput.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (chatPollingInterval) {
            clearInterval(chatPollingInterval);
            chatPollingInterval = null;
        }
    } else {
        if (disabledBanner) disabledBanner.style.display = 'none';
        if (liveBadge) {
            liveBadge.innerText = '● Live Match Chat';
            liveBadge.style.color = 'var(--accent-green)';
            liveBadge.style.background = 'rgba(16, 185, 129, 0.1)';
            liveBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        }
        if (msgInput) msgInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;

        // Auto-poll for new messages every 4 seconds
        if (!chatPollingInterval) {
            chatPollingInterval = setInterval(() => {
                pollChatMessages(activity._id, hostId);
            }, 4000);
        }
    }

    renderChatMessages(activity.messages || [], hostId);
}

function renderChatMessages(messages, hostId) {
    const box = el('chat-messages-list');
    if (!box) return;

    if (!messages || messages.length === 0) {
        box.innerHTML = '<div class="empty-state-box" style="padding: 20px;">No messages yet. Send a message to coordinate with the host and teammates!</div>';
        return;
    }

    box.innerHTML = '';
    messages.forEach(msg => {
        const sender = msg.sender || {};
        const senderId = (sender._id || sender.id || sender).toString();
        const isMe = currentUser && senderId === currentUser.id;
        const isMsgHost = hostId && senderId === hostId.toString();

        const row = document.createElement('div');
        row.className = `chat-msg-row ${isMe ? 'me' : 'other'}`;

        const senderLabel = isMe ? 'You' : (sender.name || 'Member');
        const roleBadge = isMsgHost ? ' (Host)' : '';
        const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        row.innerHTML = `
            <div class="chat-bubble">
                ${escapeHtml(msg.text)}
            </div>
            <div class="chat-meta">
                <strong>${escapeHtml(senderLabel)}${roleBadge}</strong>
                <span>${timeStr}</span>
            </div>
        `;
        box.appendChild(row);
    });

    // Auto-scroll to bottom of chat
    box.scrollTop = box.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text || '';
    return div.innerHTML;
}

async function sendChatMessage(event) {
    event.preventDefault();
    if (!activeChatActivityId || !requireLogin()) return;

    const input = el('chat-message-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    try {
        const response = await sendRequest(`/activities/${activeChatActivityId}/messages`, {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify({ text })
        });

        if (input) input.value = '';
        hideStatus('chat-status');

        const hostId = response.activity?.user?._id || response.activity?.user;
        renderChatMessages(response.messages || response.activity?.messages || [], hostId);
    } catch (err) {
        showStatus('chat-status', err.message, 'error');
        // If event expired, disable chat
        if (err.message.includes('passed') || err.message.includes('disabled')) {
            const disabledBanner = el('chat-disabled-banner');
            if (disabledBanner) disabledBanner.style.display = 'flex';
            if (input) input.disabled = true;
            const sendBtn = el('chat-send-btn');
            if (sendBtn) sendBtn.disabled = true;
            if (chatPollingInterval) {
                clearInterval(chatPollingInterval);
                chatPollingInterval = null;
            }
        }
    }
}

async function pollChatMessages(activityId, hostId) {
    if (!authToken || !activityId) return;

    try {
        const data = await sendRequest(`/activities/${activityId}/messages`, {
            headers: authHeaders()
        });

        if (data.isExpired) {
            const disabledBanner = el('chat-disabled-banner');
            if (disabledBanner) disabledBanner.style.display = 'flex';
            const msgInput = el('chat-message-input');
            if (msgInput) msgInput.disabled = true;
            const sendBtn = el('chat-send-btn');
            if (sendBtn) sendBtn.disabled = true;
            if (chatPollingInterval) {
                clearInterval(chatPollingInterval);
                chatPollingInterval = null;
            }
        }

        renderChatMessages(data.messages || [], hostId);
    } catch (e) {
        // Silent catch for background polling
    }
}

async function submitJoinRequest(activityId) {
    showStatus('action-status', 'Sending join request to host...', 'info');

    try {
        const response = await sendRequest(`/activities/${activityId}/request-join`, {
            method: 'POST',
            headers: authHeaders()
        });

        showStatus('action-status', 'Join request submitted! Waiting for host confirmation.', 'success');
        renderActivityDetails(response.activity);
    } catch (err) {
        showStatus('action-status', err.message, 'error');
    }
}

async function confirmParticipant(activityId, userId) {
    try {
        const response = await sendRequest(`/activities/${activityId}/confirm-participant`, {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify({ userId })
        });

        renderActivityDetails(response.activity);
    } catch (err) {
        alert(`Failed to confirm participant: ${err.message}`);
    }
}

