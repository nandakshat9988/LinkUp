const NODE_SERVER = 'http://localhost:3000/api';

let authToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');

function el(id) {
    return document.getElementById(id);
}

function value(id) {
    return el(id).value.trim();
}

function setText(id, text) {
    const node = el(id);
    if (node) node.innerText = text;
}

function authHeaders(hasBody) {
    const headers = {};
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return headers;
}

async function sendRequest(path, options) {
    const response = await fetch(`${NODE_SERVER}${path}`, options || {});
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
    window.location.href = 'login.html';
}

function requireLogin() {
    if (!authToken) {
        window.location.href = 'login.html';
        return false;
    }

    return true;
}

async function register(event) {
    event.preventDefault();

    const body = {
        name: value('register-name'),
        email: value('register-email'),
        password: value('register-password'),
        skillLevel: el('register-skill').value
    };

    try {
        const data = await sendRequest('/auth/register', {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify(body)
        });

        saveSession(data.token, data.user);
        window.location.href = 'dashboard.html';
    } catch (err) {
        setText('register-status', err.message);
    }
}

async function login(event) {
    event.preventDefault();

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
        window.location.href = 'dashboard.html';
    } catch (err) {
        setText('login-status', err.message);
    }
}

function startDashboard() {
    if (!requireLogin()) return;
    if (!currentUser) {
        logout();
        return;
    }

    setText('current-user', currentUser.name);
    setText('current-email', currentUser.email);
    setText('current-skill', currentUser.skillLevel || 'beginner');

    loadAllPosts();
    loadMyPosts();
}

function postActivity(event) {
    event.preventDefault();
    if (!requireLogin()) return;

    setText('post-status', 'Getting your location...');

    navigator.geolocation.getCurrentPosition(async (position) => {
        const body = {
            activityType: value('activity-type'),
            description: value('activity-description'),
            contactDetails: value('activity-contact'),
            skillLevel: el('activity-skill').value,
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
            setText('post-status', 'Activity posted.');
            loadAllPosts();
            loadMyPosts();
        } catch (err) {
            setText('post-status', err.message);
        }
    }, () => {
        setText('post-status', 'Please allow location access to post.');
    });
}

async function loadAllPosts() {
    try {
        const posts = await sendRequest('/activities');
        const list = el('posts-list');
        if (!list) return;

        list.innerHTML = '';

        if (posts.length === 0) {
            addEmptyItem(list, 'No posts yet.');
            return;
        }

        posts.forEach((post) => {
            list.appendChild(makePostItem(post, 'recent'));
        });
    } catch (err) {
        setText('radius-status', err.message);
    }
}

function findNearby() {
    setText('radius-status', 'Getting your location...');

    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        try {
            const data = await sendRequest(`/activities/nearby?lat=${lat}&lng=${lng}`);
            const list = el('nearby-list');
            list.innerHTML = '';

            setText('radius-status', `Search radius: ${data.radiusKm} km. Found ${data.count} posts.`);

            if (!data.activities || data.activities.length === 0) {
                addEmptyItem(list, 'No nearby open activities found.');
                return;
            }

            data.activities.forEach((post) => {
                list.appendChild(makePostItem(post, 'nearby'));
            });
        } catch (err) {
            setText('radius-status', err.message);
        }
    }, () => {
        setText('radius-status', 'Please allow location access to search nearby.');
    });
}

function getRecommendations() {
    if (!requireLogin()) return;
    const list = el('recommendation-list');
    list.innerHTML = '';
    addEmptyItem(list, 'Getting your location...');

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
                addEmptyItem(list, 'No suggestions found right now.');
                return;
            }

            data.recommendations.forEach((post) => {
                list.appendChild(makePostItem(post, 'suggested'));
            });
        } catch (err) {
            list.innerHTML = '';
            addEmptyItem(list, err.message);
        }
    }, () => {
        list.innerHTML = '';
        addEmptyItem(list, 'Please allow location access to get suggestions.');
    });
}

async function loadMyPosts() {
    if (!requireLogin()) return;

    try {
        const posts = await sendRequest('/activities/mine', {
            headers: authHeaders()
        });

        const list = el('my-posts-list');
        if (!list) return;

        list.innerHTML = '';

        if (posts.length === 0) {
            addEmptyItem(list, 'You have not posted any activities yet.');
            return;
        }

        posts.forEach((post) => {
            list.appendChild(makeEditItem(post));
        });
    } catch (err) {
        setText('my-posts-status', err.message);
    }
}

async function savePost(id) {
    const body = {
        activityType: value(`edit-type-${id}`),
        description: value(`edit-description-${id}`),
        contactDetails: value(`edit-contact-${id}`),
        skillLevel: el(`edit-skill-${id}`).value
    };

    try {
        await sendRequest(`/activities/${id}`, {
            method: 'PUT',
            headers: authHeaders(true),
            body: JSON.stringify(body)
        });

        setText('my-posts-status', 'Post updated.');
        loadAllPosts();
        loadMyPosts();
    } catch (err) {
        setText('my-posts-status', err.message);
    }
}

async function completePost(id) {
    try {
        await sendRequest(`/activities/${id}/complete`, {
            method: 'PATCH',
            headers: authHeaders()
        });

        setText('my-posts-status', 'Post marked as completed.');
        loadAllPosts();
        loadMyPosts();
    } catch (err) {
        setText('my-posts-status', err.message);
    }
}

async function deletePost(id) {
    const shouldDelete = confirm('Delete this post?');
    if (!shouldDelete) return;

    try {
        await sendRequest(`/activities/${id}`, {
            method: 'DELETE',
            headers: authHeaders()
        });

        setText('my-posts-status', 'Post deleted.');
        loadAllPosts();
        loadMyPosts();
    } catch (err) {
        setText('my-posts-status', err.message);
    }
}

async function joinActivity(id) {
    if (!authToken) {
        window.location.href = 'login.html';
        return;
    }

    try {
        const post = await sendRequest(`/activities/${id}/join`, {
            method: 'POST',
            headers: authHeaders()
        });

        showJoinDetails(post);
        loadAllPosts();
        loadMyPosts();
    } catch (err) {
        showJoinMessage(err.message);
    }
}

function makePostItem(post, source) {
    const item = document.createElement('li');
    const textBox = document.createElement('div');
    const title = document.createElement('strong');
    const description = document.createElement('span');
    const meta = document.createElement('small');
    const button = document.createElement('button');

    const id = post._id || post.id;
    const status = post.status || 'open';
    const host = post.user?.name || 'Someone';
    const skill = post.skillLevel || 'beginner';

    title.innerText = `${post.activityType} - ${status}`;
    description.innerText = post.description;
    meta.innerText = getPostMeta(post, source, host, skill);

    textBox.className = 'post-text';
    textBox.appendChild(title);
    textBox.appendChild(description);
    textBox.appendChild(meta);

    button.className = 'btn small';
    button.innerText = getJoinButtonText(post);
    button.disabled = !canShowJoinButton(post);
    button.onclick = () => joinActivity(id);

    item.appendChild(textBox);
    item.appendChild(button);
    return item;
}

function getPostMeta(post, source, host, skill) {
    if (source === 'nearby') {
        const meters = Math.round(post.distanceMeters || 0);
        return `${skill} skill - ${meters} m away`;
    }

    if (source === 'suggested') {
        const score = post.score ? post.score.toFixed(2) : '0.00';
        return `${skill} skill - score ${score}`;
    }

    return `Posted by ${host} - ${skill} skill`;
}

function canShowJoinButton(post) {
    if ((post.status || 'open') === 'completed') return false;
    if (!currentUser || !post.user) return true;

    const ownerId = post.user._id || post.user;
    return ownerId !== currentUser.id;
}

function getJoinButtonText(post) {
    if ((post.status || 'open') === 'completed') return 'Completed';
    if (!canShowJoinButton(post)) return 'Your post';
    return 'Join';
}

function makeEditItem(post) {
    const item = document.createElement('li');
    const form = document.createElement('div');
    const actions = document.createElement('div');
    const id = post._id;

    form.className = 'edit-form';
    actions.className = 'action-row';

    form.appendChild(makeInput(`edit-type-${id}`, post.activityType));
    form.appendChild(makeInput(`edit-description-${id}`, post.description));
    form.appendChild(makeInput(`edit-contact-${id}`, post.contactDetails || ''));
    form.appendChild(makeSkillSelect(`edit-skill-${id}`, post.skillLevel));

    actions.appendChild(makeActionButton('Save', () => savePost(id)));
    actions.appendChild(makeActionButton('Complete', () => completePost(id), post.status === 'completed'));
    actions.appendChild(makeActionButton('Delete', () => deletePost(id)));

    item.appendChild(makeStatusText(post));
    item.appendChild(form);
    item.appendChild(actions);
    return item;
}

function makeInput(id, text) {
    const input = document.createElement('input');
    input.id = id;
    input.value = text || '';
    return input;
}

function makeSkillSelect(id, selectedSkill) {
    const select = document.createElement('select');
    const skills = ['beginner', 'intermediate', 'advanced'];

    select.id = id;

    skills.forEach((skill) => {
        const option = document.createElement('option');
        option.value = skill;
        option.innerText = skill;
        option.selected = skill === selectedSkill;
        select.appendChild(option);
    });

    return select;
}

function makeStatusText(post) {
    const status = document.createElement('small');
    const count = post.participants ? post.participants.length : 0;
    status.innerText = `Status: ${post.status || 'open'} - Joined users: ${count}`;
    return status;
}

function makeActionButton(text, onClick, disabled) {
    const button = document.createElement('button');
    button.className = 'btn small';
    button.innerText = text;
    button.disabled = disabled;
    button.onclick = onClick;
    return button;
}

function showJoinDetails(post) {
    const joinedUsers = post.participants || [];
    const hostName = post.user?.name || 'Unknown host';
    const savedContact = post.contactDetails || post.user?.email || 'No contact details saved';

    el('join-details').style.display = 'block';
    setText('join-title', post.activityType);
    setText('join-description', post.description);
    setText('join-host', `Host: ${hostName}`);
    setText('join-contact', `Contact: ${savedContact}`);
    setText('join-skill', `Skill: ${post.skillLevel || 'beginner'}`);
    setText('join-players', `Joined users: ${joinedUsers.length}`);
}

function showJoinMessage(message) {
    el('join-details').style.display = 'block';
    setText('join-title', 'Join message');
    setText('join-description', message);
    setText('join-host', '');
    setText('join-contact', '');
    setText('join-skill', '');
    setText('join-players', '');
}

function addEmptyItem(list, text) {
    const item = document.createElement('li');
    item.className = 'empty-item';
    item.innerText = text;
    list.appendChild(item);
}
