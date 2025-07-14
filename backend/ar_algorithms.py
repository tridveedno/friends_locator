import cv2
import numpy as np
import base64
import io
from PIL import Image
import math
import json

class ARLandmarkTracker:
    """
    Real AR landmark tracking system using computer vision.
    This class is now parameterized to accept real-world data.
    """
    
    # ADJUSTMENT: The __init__ method now accepts an optional camera_matrix.
    def __init__(self, camera_matrix=None):
        """
        Initializes the tracker.
        :param camera_matrix: A 3x3 numpy array with the camera's intrinsic parameters.
        """
        self.sift = cv2.SIFT_create()
        
        FLANN_INDEX_KDTREE = 1
        index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
        search_params = dict(checks=50)
        self.flann = cv2.FlannBasedMatcher(index_params, search_params)
        
        # ADJUSTMENT: Use the provided camera_matrix or a default placeholder.
        if camera_matrix is not None:
            self.camera_matrix = camera_matrix
        else:
            # WARNING: This is a GENERIC placeholder. For accurate results, you must
            # provide a matrix obtained from calibrating the user's specific camera.
            self.camera_matrix = np.array([
                [800, 0, 320],
                [0, 800, 240],
                [0, 0, 1]
            ], dtype=np.float32)
        
        self.dist_coeffs = np.zeros((4, 1))
        
        self.reference_keypoints = None
        self.reference_descriptors = None
        self.reference_image = None
        
    def base64_to_image(self, base64_string):
        if base64_string.startswith("data:image"):
            base64_string = base64_string.split(",")[1]
        
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data))
        return cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    
    def extract_features(self, image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return self.sift.detectAndCompute(gray, None)
    
    def set_reference_landmark(self, reference_image_base64):
        self.reference_image = self.base64_to_image(reference_image_base64)
        self.reference_keypoints, self.reference_descriptors = self.extract_features(self.reference_image)
        if self.reference_descriptors is None:
            raise ValueError("No features detected in reference image")
        return len(self.reference_keypoints)
    
    def match_features(self, descriptors1, descriptors2):
        if descriptors1 is None or descriptors2 is None or len(descriptors1) < 2 or len(descriptors2) < 2:
            return []
            
        matches = self.flann.knnMatch(descriptors1, descriptors2, k=2)
        
        good_matches = []
        for match_pair in matches:
            if len(match_pair) == 2:
                m, n = match_pair
                if m.distance < 0.75 * n.distance:
                    good_matches.append(m)
        return good_matches
    
    # ADJUSTMENT: This method now requires the landmark's real-world size to calculate pose in meters.
    def estimate_pose_from_homography(self, keypoints1, keypoints2, matches, landmark_real_size_meters):
        """
        Calculates pose. The key change is defining the object's corners in meters.
        :param landmark_real_size_meters: A tuple (width, height) of the physical landmark in meters.
        """
        if len(matches) < 4:
            return None, None
            
        src_pts = np.float32([keypoints1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([keypoints2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        
        homography, _ = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        
        if homography is None:
            return None, None

        # ADJUSTMENT: Get the real-world size from the new parameter.
        real_width, real_height = landmark_real_size_meters

        # ADJUSTMENT: Define the 3D points of the landmark using its REAL-WORLD SIZE IN METERS.
        # This is the most critical change for accurate distance calculation.
        object_points = np.array([
            [0, 0, 0],
            [real_width, 0, 0],
            [real_width, real_height, 0],
            [0, real_height, 0]
        ], dtype=np.float32)

        # The 2D points of the reference image are still its pixel corners.
        h, w = self.reference_image.shape[:2]
        image_plane_points = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32).reshape(-1, 1, 2)
        
        transformed_corners = cv2.perspectiveTransform(image_plane_points, homography)
        
        # Now, solvePnP compares the 3D meter points to the 2D pixel points.
        # The resulting translation vector (tvec) will be in meters.
        success, rvec, tvec = cv2.solvePnP(object_points, transformed_corners, self.camera_matrix, self.dist_coeffs)
        
        return (rvec, tvec) if success else (None, None)
    
    def calculate_distance_and_angle(self, tvec):
        if tvec is None:
            return None, None
            
        # ADJUSTMENT: The distance is now inherently in meters because of the changes above.
        distance_meters = np.linalg.norm(tvec)
        
        x, _, z = tvec.flatten()
        angle_rad = math.atan2(x, z)
        angle_deg = math.degrees(angle_rad)
        
        return distance_meters, angle_deg
    
    # ADJUSTMENT: The main analysis function now also needs the landmark's real size.
    def analyze_ar_frame(self, current_frame_base64, landmark_real_size_meters):
        if self.reference_descriptors is None:
            return {'success': False, 'error': 'Reference landmark not set'}
            
        current_image = self.base64_to_image(current_frame_base64)
        current_keypoints, current_descriptors = self.extract_features(current_image)
        
        if current_descriptors is None or len(current_keypoints) < 10:
            return {'success': False, 'error': 'Not enough features in current frame'}
        
        matches = self.match_features(self.reference_descriptors, current_descriptors)
        
        if len(matches) < 4:
            return {'success': False, 'error': 'Not enough matches found'}
        
        # ADJUSTMENT: Pass the landmark size down to the pose estimation function.
        rvec, tvec = self.estimate_pose_from_homography(
            self.reference_keypoints, current_keypoints, matches, landmark_real_size_meters
        )
        
        if tvec is None:
            return {'success': False, 'error': 'Could not estimate pose'}
            
        distance, angle = self.calculate_distance_and_angle(tvec)

        # ADJUSTMENT: The arbitrary "magic number" conversion is now REMOVED.
        # distance_meters = distance * 0.1 # <-- This incorrect line is gone.
        
        return {
            'success': True,
            'distance': distance, # This is already in meters.
            'angle': abs(angle),
            'direction': 'right' if angle > 0 else 'left'
        }


# ADJUSTMENT: The GoniometricCalculator and ARNavigationSystem classes would need
# further significant changes to integrate GPS and Compass data from the frontend.
# The code below is kept for structure but is not fully functional without those changes.

class GoniometricCalculator:
    # This class is mathematically correct for GPS calculations.
    # No changes are needed here, but it remains unused by the vision system.
    def __init__(self):
        self.earth_radius = 6371000
    # ... (rest of the class methods are unchanged) ...

class ARNavigationSystem:
    def __init__(self, camera_matrix=None):
        self.tracker = ARLandmarkTracker(camera_matrix=camera_matrix)

    def initialize_system(self, reference_photo_base64):
        try:
            feature_count = self.tracker.set_reference_landmark(reference_photo_base64)
            return {'success': True, 'feature_count': feature_count}
        except Exception as e:
            return {'success': False, 'error': f"Initialization failed: {str(e)}"}

    def process_ar_frame(self, current_frame_base64, landmark_real_size_meters):
        """
        Processes a single AR frame using landmark size provided by the user.
        :param current_frame_base64: The base64-encoded image from the user's camera.
        :param landmark_real_size_meters: A tuple (width, height) of the landmark in meters, provided by the user.
        """
        try:
            result = self.tracker.analyze_ar_frame(current_frame_base64, landmark_real_size_meters)
            
            if not result['success']:
                return result
            
            distance = result['distance']
            angle = result['angle']
            direction = result['direction']
            
            if distance < 5:
                instruction = "You're very close! Look around."
            else:
                instruction = f"Go {int(distance)}m towards the landmark, then look {int(angle)}° {direction}"
            
            result['instruction'] = instruction
            return result
            
        except Exception as e:
            return {'success': False, 'error': f"AR processing failed: {str(e)}"}