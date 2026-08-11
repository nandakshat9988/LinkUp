from flask import Flask, request, jsonify
from sklearn.neighbors import NearestNeighbors
import numpy as np

app = Flask(__name__)

# In a real app, this data comes from a database. 
# We keep it in memory here for simplicity.
# Format: [latitude, longitude]
activity_locations = []
activity_details = []

@app.route('/train', methods=['POST'])
def add_data():
    """Adds a new activity to our dataset so the ML model can learn it."""
    data = request.json
    activity_locations.append([data['lat'], data['lng']])
    activity_details.append(data['activity'])
    return jsonify({"status": "success"})

@app.route('/recommend', methods=['POST'])
def recommend():
    """Uses KNN to find the nearest activities to the user's current GPS location."""
    if len(activity_locations) == 0:
        return jsonify({"recommendations": []})

    user_data = request.json
    user_location = np.array([[user_data['lat'], user_data['lng']]])

    # ML Model: K-Nearest Neighbors (Finds closest points in 2D space)
    # n_neighbors ensures we don't ask for more neighbors than we actually have
    neighbors_to_find = min(3, len(activity_locations)) 
    model = NearestNeighbors(n_neighbors=neighbors_to_find, algorithm='ball_tree')
    
    # Train the model on the current active locations
    model.fit(activity_locations)
    
    # Find the nearest activities
    distances, indices = model.kneighbors(user_location)
    
    # Gather the names of the recommended activities
    recommendations = []
    for i in indices[0]:
        recommendations.append(activity_details[i])

    return jsonify({"recommendations": recommendations})

if __name__ == '__main__':
    # Running on port 5000
    app.run(port=5000, debug=True)