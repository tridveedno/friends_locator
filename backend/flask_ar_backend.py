from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import base64
import cv2
import numpy as np
from ar_algorithms import analyze_images_for_directions, track_ar

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:3000", "https://friends-locator-static.onrender.com"]}})

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s %(levelname)s: %(message)s',
    handlers=[
        logging.FileHandler('ar_backend.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@app.route('/api/ar/initialize', methods=['POST'])
def initialize_ar():
    logger.debug("Received request to /api/ar/initialize")
    try:
        data = request.get_json()
        if not data:
            logger.error("No JSON data provided in request")
            return jsonify({"success": False, "error": "No data provided"}), 400

        friend_photo = data.get('friend_photo')
        user_photo = data.get('user_photo')
        mode = data.get('mode')

        if not friend_photo or not user_photo or not mode:
            logger.error("Missing required fields: friend_photo=%s, user_photo=%s, mode=%s",
                        bool(friend_photo), bool(user_photo), mode)
            return jsonify({"success": False, "error": "Missing friend_photo, user_photo, or mode"}), 400

        if mode not in ['ar', 'standard']:
            logger.error("Invalid mode: %s", mode)
            return jsonify({"success": False, "error": f"Invalid mode: {mode}"}), 400

        logger.debug("Request data: mode=%s, friend_photo_length=%d, user_photo_length=%d, friend_photo_preview=%s, user_photo_preview=%s",
                    mode, len(friend_photo), len(user_photo), friend_photo[:50], user_photo[:50])

        # Decode base64 images
        try:
            friend_photo_data = base64.b64decode(friend_photo.split(',')[1])
            user_photo_data = base64.b64decode(user_photo.split(',')[1])
            logger.debug("Decoded images: friend_photo_size=%d bytes, user_photo_size=%d bytes",
                        len(friend_photo_data), len(user_photo_data))
        except Exception as e:
            logger.error("Failed to decode base64 images: %s", str(e))
            return jsonify({"success": False, "error": f"Invalid image data: {str(e)}"}), 400

        # Convert to OpenCV images
        try:
            friend_img = cv2.imdecode(np.frombuffer(friend_photo_data, np.uint8), cv2.IMREAD_COLOR)
            user_img = cv2.imdecode(np.frombuffer(user_photo_data, np.uint8), cv2.IMREAD_COLOR)
            if friend_img is None or user_img is None:
                logger.error("Failed to decode images to OpenCV format: friend_img=%s, user_img=%s",
                            friend_img is None, user_img is None)
                return jsonify({"success": False, "error": "Failed to decode images"}), 400
            logger.debug("OpenCV images created: friend_img_shape=%s, user_img_shape=%s",
                        str(friend_img.shape), str(user_img.shape))
        except Exception as e:
            logger.error("Error processing images: %s", str(e))
            return jsonify({"success": False, "error": f"Image processing error: {str(e)}"}), 500

        # Call algorithm
        try:
            result = analyze_images_for_directions(friend_img, user_img, mode)
            logger.debug("analyze_images_for_directions result: %s", result)
            if not result.get('success'):
                logger.warning("Analysis failed: %s", result.get('error', 'No error message'))
                return jsonify(result), 200
            return jsonify(result), 200
        except Exception as e:
            logger.error("Error in analyze_images_for_directions: %s", str(e))
            return jsonify({"success": False, "error": f"Analysis error: {str(e)}"}), 500

    except Exception as e:
        logger.error("Unexpected error in /api/ar/initialize: %s", str(e))
        return jsonify({"success": False, "error": f"Server error: {str(e)}"}), 500

@app.route('/api/ar/track', methods=['POST'])
def track_ar_route():
    logger.debug("Received request to /api/ar/track")
    try:
        data = request.get_json()
        if not data:
            logger.error("No JSON data provided in request")
            return jsonify({"success": False, "error": "No data provided"}), 400

        current_frame = data.get('current_frame')
        if not current_frame:
            logger.error("Missing current_frame")
            return jsonify({"success": False, "error": "Missing current_frame"}), 400

        logger.debug("Track request data: current_frame_length=%d, current_frame_preview=%s",
                    len(current_frame), current_frame[:50])

        # Decode base64 frame
        try:
            frame_data = base64.b64decode(current_frame.split(',')[1])
            logger.debug("Decoded frame: size=%d bytes", len(frame_data))
        except Exception as e:
            logger.error("Failed to decode base64 frame: %s", str(e))
            return jsonify({"success": False, "error": f"Invalid frame data: {str(e)}"}), 400

        # Convert to OpenCV image
        try:
            frame_img = cv2.imdecode(np.frombuffer(frame_data, np.uint8), cv2.IMREAD_COLOR)
            if frame_img is None:
                logger.error("Failed to decode frame to OpenCV format")
                return jsonify({"success": False, "error": "Failed to decode frame"}), 400
            logger.debug("OpenCV frame created: shape=%s", str(frame_img.shape))
        except Exception as e:
            logger.error("Error processing frame: %s", str(e))
            return jsonify({"success": False, "error": f"Frame processing error: {str(e)}"}), 500

        # Call tracking algorithm
        try:
            result = track_ar(frame_img)
            logger.debug("track_ar result: %s", result)
            if not result.get('success'):
                logger.warning("Tracking failed: %s", result.get('error', 'No error message'))
                return jsonify(result), 200
            return jsonify(result), 200
        except Exception as e:
            logger.error("Error in track_ar: %s", str(e))
            return jsonify({"success": False, "error": f"Tracking error: {str(e)}"}), 500

    except Exception as e:
        logger.error("Unexpected error in /api/ar/track: %s", str(e))
        return jsonify({"success": False, "error": f"Server error: {str(e)}"}), 500

if __name__ == '__main__':
    logger.info("Starting Flask server on port 5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
