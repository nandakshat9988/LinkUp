const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); // Allows our frontend to talk to this backend
app.use(express.json()); // Allows us to read JSON data

// Simple in-memory storage for our posts
let posts = [];

// 1. Route to create a new activity post
app.post('/api/posts', async (req, res) => {
    const { user, activity, lat, lng } = req.body;
    
    const newPost = { user, activity, lat, lng };
    posts.push(newPost);

    // Send this new data to our Python ML service so it can learn about it
    try {
        await fetch('http://127.0.0.1:5000/train', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPost)
        });
    } catch (error) {
        console.log("Could not connect to Python ML service.");
    }

    res.json({ message: "Post created successfully!", post: newPost });
});

// 2. Route to get all posts (for the main feed)
app.get('/api/posts', (req, res) => {
    res.json(posts);
});

// 3. Route to get ML recommendations based on user location
app.post('/api/recommendations', async (req, res) => {
    const { lat, lng } = req.body;
    
    try {
        // Ask the Python ML service what is nearby
        const response = await fetch('http://127.0.0.1:5000/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng })
        });
        const mlData = await response.json();
        res.json(mlData);
    } catch (error) {
        res.status(500).json({ error: "ML Service is down" });
    }
});

app.listen(3000, () => {
    console.log('Node.js server is running on http://localhost:3000');
});