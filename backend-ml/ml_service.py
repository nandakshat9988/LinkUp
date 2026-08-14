import os
from flask import Flask, request, jsonify
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "ml-service"})

# Weights for the hybrid score. These are the "knobs" you'd tune based on
# what actually matters to your product (e.g. weight proximity higher for a
# "meet up right now" feature, weight content higher for a browse/discovery feed).
W_GEO = 0.4
W_COLLAB = 0.3
W_CONTENT = 0.3
SKILL_MATCH_BONUS = 0.15


@app.route('/recommend', methods=['POST'])
def recommend():
    data = request.json
    radius_km = data.get('radiusKm', 10)
    my_skill = data.get('skillLevel', 'beginner')
    history = data.get('history', [])       # activities this user has joined before
    candidates = data.get('candidates', [])  # geo-filtered shortlist from MongoDB (Node)

    if not candidates:
        return jsonify({"recommendations": []})

    # ---- 1. Geospatial score ----
    # Node already computed the real distance using the 2dsphere index; here
    # we just normalize it to 0-1 so it's comparable to the other scores.
    for c in candidates:
        distance_km = c['distanceMeters'] / 1000
        c['geo_score'] = max(0, 1 - (distance_km / radius_km))

    # ---- 2. Collaborative filtering ----
    # Simple, explainable version: reward activity types this user has
    # engaged with before, proportional to how often. (A larger production
    # system would do this across ALL users' interaction data with matrix
    # factorization or item-item similarity — same idea, more data.)
    type_counts = {}
    for h in history:
        type_counts[h['activityType']] = type_counts.get(h['activityType'], 0) + 1
    max_count = max(type_counts.values()) if type_counts else 1

    for c in candidates:
        c['collab_score'] = type_counts.get(c['activityType'], 0) / max_count

    # ---- 3. Content-based / vector similarity ----
    # TF-IDF + cosine similarity is a lightweight stand-in for real semantic
    # embeddings. It compares word overlap, so it won't know "box cricket"
    # and "leather ball cricket" are related unless they share words.
    # PRODUCTION UPGRADE: replace TfidfVectorizer with a sentence-transformer
    # embedding model, store vectors in FAISS/Pinecone, and query by nearest
    # neighbor there instead — that's what actually captures meaning, not
    # just shared vocabulary.
    history_text = " ".join(h['description'] for h in history) or my_skill
    corpus = [history_text] + [c['description'] for c in candidates]
    tfidf_matrix = TfidfVectorizer(stop_words='english').fit_transform(corpus)
    similarities = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:]).flatten()

    for c, sim in zip(candidates, similarities):
        c['content_score'] = float(sim)
        c['skill_bonus'] = SKILL_MATCH_BONUS if c['skillLevel'] == my_skill else 0

    # ---- 4. Combine into one hybrid score ----
    for c in candidates:
        c['score'] = (
            W_GEO * c['geo_score']
            + W_COLLAB * c['collab_score']
            + W_CONTENT * c['content_score']
            + c['skill_bonus']
        )

    ranked = sorted(candidates, key=lambda c: c['score'], reverse=True)
    return jsonify({"recommendations": ranked[:10]})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
