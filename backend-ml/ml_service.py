import os
from flask import Flask, request, jsonify
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "ml-service"})

# Hybrid scoring weights:
# - W_GEO: Geographic proximity score
# - W_COLLAB: Collaborative history match (activities similar to what user has joined)
# - W_CONTENT: Semantic text similarity (TF-IDF + Cosine similarity)
W_GEO = 0.4
W_COLLAB = 0.3
W_CONTENT = 0.3

@app.route('/recommend', methods=['POST'])
def recommend():
    data = request.json or {}
    radius_km = data.get('radiusKm', 10)
    history = data.get('history', [])       # activities this user has joined before
    candidates = data.get('candidates', [])  # geo-filtered shortlist from MongoDB

    if not candidates:
        return jsonify({"recommendations": []})

    # 1. Collaborative frequency calculation from user engagement history
    type_counts = {}
    for h in history:
        act_type = h.get('activityType')
        if act_type:
            type_counts[act_type] = type_counts.get(act_type, 0) + 1
    max_count = max(type_counts.values()) if type_counts else 1

    # 2. Content-based text similarity using TF-IDF and Cosine Similarity
    history_text = " ".join(h.get('description', '') for h in history).strip() or "sports fitness workout recreation"
    corpus = [history_text] + [c.get('description', '') for c in candidates]
    
    tfidf_matrix = TfidfVectorizer(stop_words='english').fit_transform(corpus)
    similarities = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:]).flatten()

    # 3. Calculate combined hybrid scores for each candidate
    for c, sim in zip(candidates, similarities):
        distance_km = (c.get('distanceMeters') or 0) / 1000
        geo_score = max(0, 1 - (distance_km / radius_km))
        collab_score = type_counts.get(c.get('activityType'), 0) / max_count
        content_score = float(sim)

        c['geo_score'] = round(geo_score, 3)
        c['collab_score'] = round(collab_score, 3)
        c['content_score'] = round(content_score, 3)
        c['score'] = round(
            W_GEO * geo_score + W_COLLAB * collab_score + W_CONTENT * content_score,
            3
        )

    ranked = sorted(candidates, key=lambda c: c['score'], reverse=True)
    return jsonify({"recommendations": ranked[:10]})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
