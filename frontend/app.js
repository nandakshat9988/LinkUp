const NODE_SERVER = 'http://localhost:3000/api';

// Function to handle creating a new post
function postActivity() {
    const username = document.getElementById('username').value;
    const activity = document.getElementById('activity').value;
    const statusText = document.getElementById('status');

    if (!username || !activity) {
        statusText.innerText = "Please fill in all fields.";
        return;
    }

    statusText.innerText = "Getting GPS location...";

    // Use built-in browser Geolocation API
    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        const postData = { user: username, activity: activity, lat: lat, lng: lng };

        // Send to Node.js backend
        await fetch(`${NODE_SERVER}/posts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postData)
        });

        statusText.innerText = "Activity posted successfully!";
        loadAllPosts(); // Refresh the list
    }, () => {
        statusText.innerText = "Error getting location. Please allow GPS permissions.";
    });
}

// Function to fetch all posts
async function loadAllPosts() {
    const response = await fetch(`${NODE_SERVER}/posts`);
    const posts = await response.json();
    
    const list = document.getElementById('posts-list');
    list.innerHTML = ""; // Clear current list
    
    posts.forEach(post => {
        const li = document.createElement('li');
        li.innerText = `${post.user} is doing: ${post.activity} (Lat: ${post.lat.toFixed(2)}, Lng: ${post.lng.toFixed(2)})`;
        list.appendChild(li);
    });
}

// Function to ask for ML recommendations based on current location
function getRecommendations() {
    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        const response = await fetch(`${NODE_SERVER}/recommendations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lng: lng })
        });

        const data = await response.json();
        const list = document.getElementById('recommendation-list');
        list.innerHTML = "";

        if (data.recommendations && data.recommendations.length > 0) {
            data.recommendations.forEach(rec => {
                const li = document.createElement('li');
                li.innerText = `Suggested near you: ${rec}`;
                list.appendChild(li);
            });
        } else {
            list.innerHTML = "<li>No nearby activities found right now.</li>";
        }
    });
}

// Load posts when the page first opens
window.onload = loadAllPosts;