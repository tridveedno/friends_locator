from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
import base64
import io
from PIL import Image
import math
import json
import logging
from ar_algorithms import ARNavigationSystem, ARLandmarkTracker, GoniometricCalculator

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global AR system instance
ar_system = ARNavigationSystem()

def base64_to_image(base64_string):
    """Convert base64 string to OpenCV image"""
    try:
        if base64_string.startswith('data:image'):
            base64_string = base64_string.split(',')[1]
        
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data))
        image = image.convert('RGB')
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    except Exception as e:
        logger.error(f"Error converting base64 to image: {e}")
        return None

def image_to_base64(image):
    """Convert OpenCV image to base64 string"""
    try:
        _, buffer = cv2.imencode('.jpg', image)
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        return f"data:image/jpeg;base64,{image_base64}"
    except Exception as e:
        logger.error(f"Error converting image to base64: {e}")
        return None

@app.route('/api/ar/initialize', methods=['POST'])
def initialize_ar_system():
    """Initialize AR system with friend's photo and user's baseline photo"""
    try:
        data = request.get_json()
        
        if not data or 'friend_photo' not in data or 'user_photo' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required photos'
            }), 400
        
        friend_photo = data['friend_photo']
        user_photo = data['user_photo']
        
        logger.info("Initializing AR system with provided photos")
        
        # Initialize the AR system
        result = ar_system.initialize_from_photos(friend_photo, user_photo)
        
        if result['success']:
            logger.info(f"AR system initialized successfully. Features: {result.get('feature_count', 0)}")
            return jsonify(result)
        else:
            logger.error(f"AR initialization failed: {result.get('error', 'Unknown error')}")
            return jsonify(result), 500
            
    except Exception as e:
        logger.error(f"Exception in AR initialization: {e}")
        return jsonify({
            'success': False,
            'error': f'Server error during initialization: {str(e)}'
        }), 500

@app.route('/api/ar/track', methods=['POST'])
def track_ar_frame():
    """Process current AR frame for real-time tracking"""
    try:
        data = request.get_json()
        
        if not data or 'current_frame' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing current frame'
            }), 400
        
        current_frame = data['current_frame']
        
        # Process the frame
        result = ar_system.process_ar_frame(current_frame)
        
        if result['success']:
            logger.debug(f"Frame processed successfully. Distance: {result.get('distance', 0):.1f}m")
        else:
            logger.debug(f"Frame processing issue: {result.get('error', 'Unknown')}")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Exception in AR tracking: {e}")
        return jsonify({
            'success': False,
            'error': f'Server error during tracking: {str(e)}'
        }), 500

@app.route('/api/photo/analyze', methods=['POST'])
def analyze_photos():
    """Legacy endpoint for standard photo analysis (non-AR mode)"""
    try:
        data = request.get_json()
        
        if not data or 'friend_photo' not in data or 'user_photo' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required photos'
            }), 400
        
        friend_photo = data['friend_photo']
        user_photo = data['user_photo']
        
        logger.info("Processing photos for standard analysis")
        
        # Use the AR system for one-time analysis
        temp_ar_system = ARNavigationSystem()
        init_result = temp_ar_system.initialize_from_photos(friend_photo, user_photo)
        
        if not init_result['success']:
            logger.error(f"Initialization failed: {init_result.get('error')}")
            return jsonify(init_result), 500
        
        # Process the user photo as a single frame
        result = temp_ar_system.process_ar_frame(user_photo)
        
        if result['success']:
            logger.info(f"Analysis successful: Distance={result['distance']:.1f}m, Matches={result.get('matches_count', 0)}")
            return jsonify({
                'success': True,
                'distance': result['distance'],
                'angle': result['angle'],
                'direction': result['direction'],
                'instruction': result['instruction'],
                'confidence': result.get('confidence', 0.8),
                'method': 'computer_vision_analysis',
                'output_image_base64': result.get('output_image_base64')
            })
        else:
            logger.error(f"Analysis failed: {result.get('error')}, Matches={result.get('matches_count', 0)}")
            return jsonify({
                'success': False,
                'error': result.get('error'),
                'tracking_quality': result.get('tracking_quality', 'poor'),
                'output_image_base64': result.get('output_image_base64')
            }), 500
            
    except Exception as e:
        logger.error(f"Exception in photo analysis: {e}")
        return jsonify({
            'success': False,
            'error': f'Server error during analysis: {str(e)}'
        }), 500

@app.route('/api/ar/calibrate', methods=['POST'])
def calibrate_ar_system():
    """Calibrate AR system with known landmark dimensions"""
    try:
        data = request.get_json()
        
        landmark_width = data.get('landmark_width', 1.0)  # meters
        landmark_height = data.get('landmark_height', 1.0)  # meters
        
        # Update AR system calibration
        if hasattr(ar_system.tracker, 'set_landmark_dimensions'):
            ar_system.tracker.set_landmark_dimensions(landmark_width, landmark_height)
        
        return jsonify({
            'success': True,
            'message': 'AR system calibrated',
            'landmark_dimensions': {
                'width': landmark_width,
                'height': landmark_height
            }
        })
        
    except Exception as e:
        logger.error(f"Exception in AR calibration: {e}")
        return jsonify({
            'success': False,
            'error': f'Calibration failed: {str(e)}'
        }), 500

@app.route('/api/ar/status', methods=['GET'])
def get_ar_status():
    """Get current AR system status"""
    try:
        status = {
            'initialized': ar_system.tracker.reference_descriptors is not None,
            'opencv_version': cv2.__version__,
            'features_available': ['SIFT', 'ORB', 'FLANN', 'BF_Matcher'],
            'tracking_methods': ['homography', 'pose_estimation', 'feature_matching']
        }
        
        if status['initialized']:
            status['reference_features'] = len(ar_system.tracker.reference_keypoints) if ar_system.tracker.reference_keypoints else 0
        
        return jsonify({
            'success': True,
            'status': status
        })
        
    except Exception as e:
        logger.error(f"Exception getting AR status: {e}")
        return jsonify({
            'success': False,
            'error': f'Status check failed: {str(e)}'
        }), 500

@app.route('/api/ar/debug', methods=['POST'])
def debug_ar_processing():
    """Debug endpoint for AR processing with detailed output"""
    try:
        data = request.get_json()
        
        if not data or 'current_frame' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing current frame'
            }), 400
        
        current_frame = data['current_frame']
        
        # Convert to image for debugging
        image = base64_to_image(current_frame)
        if image is None:
            return jsonify({
                'success': False,
                'error': 'Invalid image format'
            }), 400
        
        # Extract features for debugging
        keypoints, descriptors = ar_system.tracker.extract_features(image, use_sift=True)
        
        debug_info = {
            'image_shape': image.shape,
            'keypoints_detected': len(keypoints) if keypoints else 0,
            'descriptors_shape': descriptors.shape if descriptors is not None else None,
            'reference_initialized': ar_system.tracker.reference_descriptors is not None
        }
        
        if ar_system.tracker.reference_descriptors is not None:
            # Try matching
            matches = ar_system.tracker.match_features(
                ar_system.tracker.reference_descriptors,
                descriptors,
                use_sift=True
            )
            debug_info['matches_found'] = len(matches)
        
        return jsonify({
            'success': True,
            'debug_info': debug_info
        })
        
    except Exception as e:
        logger.error(f"Exception in AR debug: {e}")
        return jsonify({
            'success': False,
            'error': f'Debug failed: {str(e)}'
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'opencv_available': True,
        'opencv_version': cv2.__version__
    })

if __name__ == '__main__':
    logger.info("Starting AR-enhanced Flask backend")
    logger.info(f"OpenCV version: {cv2.__version__}")
    
    # Test AR system initialization
    try:
        test_system = ARLandmarkTracker()
        logger.info("AR system components loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load AR system: {e}")
    
    app.run(host='0.0.0.0', port=5000, debug=True)