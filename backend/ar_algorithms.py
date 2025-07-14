
import cv2
import numpy as np
import base64
import io
from PIL import Image
import math
import json

class ARLandmarkTracker:
    """
    Real AR landmark tracking system using computer vision
    """
    
    def __init__(self):
        # Initialize feature detectors
        self.sift = cv2.SIFT_create()
        self.orb = cv2.ORB_create(nfeatures=1000)
        
        # FLANN matcher for SIFT features
        FLANN_INDEX_KDTREE = 1
        index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
        search_params = dict(checks=50)
        self.flann = cv2.FlannBasedMatcher(index_params, search_params)
        
        # BF matcher for ORB features
        self.bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        
        # Camera calibration parameters (typical smartphone camera)
        self.camera_matrix = np.array([
            [800, 0, 320],
            [0, 800, 240],
            [0, 0, 1]
        ], dtype=np.float32)
        
        self.dist_coeffs = np.zeros((4, 1))  # Assuming no lens distortion
        
        # Reference landmark data
        self.reference_keypoints = None
        self.reference_descriptors = None
        self.reference_image = None
        
    def base64_to_image(self, base64_string):
        """Convert base64 string to OpenCV image"""
        if base64_string.startswith("data:image"):
            base64_string = base64_string.split(",")[1]
        
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data))
        image = image.convert("RGB")
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    
    def extract_features(self, image, use_sift=True):
        """Extract features from image using SIFT or ORB"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        if use_sift:
            keypoints, descriptors = self.sift.detectAndCompute(gray, None)
        else:
            keypoints, descriptors = self.orb.detectAndCompute(gray, None)
            
        return keypoints, descriptors
    
    def set_reference_landmark(self, reference_image_base64):
        """Set the reference landmark image from friend's photo"""
        self.reference_image = self.base64_to_image(reference_image_base64)
        self.reference_keypoints, self.reference_descriptors = self.extract_features(
            self.reference_image, use_sift=True
        )
        
        if self.reference_descriptors is None:
            raise ValueError("No features detected in reference image")
            
        return len(self.reference_keypoints)
    
    def match_features(self, descriptors1, descriptors2, use_sift=True):
        """Match features between two descriptor sets"""
        if descriptors1 is None or descriptors2 is None or len(descriptors1) == 0 or len(descriptors2) == 0:
            return []
            
        if use_sift:
            # FLANN matching for SIFT
            matches = self.flann.knnMatch(descriptors1, descriptors2, k=2)
            
            # Apply Lowe's ratio test
            good_matches = []
            for match_pair in matches:
                if len(match_pair) == 2:
                    m, n = match_pair
                    if m.distance < 0.7 * n.distance:
                        good_matches.append(m)
        else:
            # BF matching for ORB
            matches = self.bf.match(descriptors1, descriptors2)
            good_matches = sorted(matches, key=lambda x: x.distance)[:50]
            
        return good_matches
    
    def calculate_homography(self, keypoints1, keypoints2, matches):
        """Calculate homography matrix between matched keypoints"""
        if len(matches) < 4:
            return None, None
            
        # Extract matched points
        src_pts = np.float32([keypoints1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([keypoints2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        
        # Find homography using RANSAC
        homography, mask = cv2.findHomography(
            src_pts, dst_pts, 
            cv2.RANSAC, 
            ransacReprojThreshold=5.0
        )
        
        return homography, mask
    
    def estimate_pose_from_homography(self, homography, image_size):
        """Estimate camera pose from homography matrix"""
        if homography is None:
            return None, None, None
            
        # Assume the reference landmark is a planar surface
        # Define 3D points of the landmark (assuming it's a rectangle)
        h, w = image_size[:2]
        object_points = np.array([
            [0, 0, 0],
            [w, 0, 0],
            [w, h, 0],
            [0, h, 0]
        ], dtype=np.float32)
        
        # Corresponding 2D points in current image
        corners_2d = np.array([
            [0, 0],
            [w, 0],
            [w, h],
            [0, h]
        ], dtype=np.float32).reshape(-1, 1, 2)
        
        # Transform corners using homography
        transformed_corners = cv2.perspectiveTransform(corners_2d, homography)
        
        # Solve PnP to get rotation and translation vectors
        success, rvec, tvec = cv2.solvePnP(
            object_points,
            transformed_corners.reshape(-1, 2),
            self.camera_matrix,
            self.dist_coeffs
        )
        
        if success:
            return rvec, tvec, transformed_corners
        else:
            return None, None, None
    
    def calculate_distance_and_angle(self, tvec, rvec=None):
        """Calculate distance and angle from translation vector"""
        if tvec is None:
            return None, None
            
        # Distance is the magnitude of translation vector
        distance = np.linalg.norm(tvec)
        
        # Angle calculation (assuming movement in XY plane)
        x, y, z = tvec.flatten()
        
        # Angle in degrees from forward direction
        angle_rad = math.atan2(x, z)
        angle_deg = math.degrees(angle_rad)
        
        return distance, angle_deg
    
    def draw_navigation_arrow(self, image, rvec, tvec, distance, angle, direction):
        """Draw an AR navigation arrow on the image"""
        if rvec is None or tvec is None:
            return image

        # Define arrow 3D points (simple arrow shape along Z-axis)
        arrow_length = 0.5  # Length in meters
        arrow_points = np.float32([
            [0, 0, 0],           # Arrow base
            [0, 0, arrow_length], # Arrow tip
            [- Sheldon[-0.1, 0, arrow_length * 0.8],  # Left wing
            [0.1, 0, arrow_length * 0.8]   # Right wing
        ])

        # Rotate arrow based on direction (left/right)
        angle_rad = math.radians(angle if direction == 'right' else -angle)
        rotation_matrix, _ = cv2.Rodrigues(rvec)
        rotation_matrix = np.dot(rotation_matrix, cv2.Rodrigues(np.array([0, 0, angle_rad]))[0])

        # Project 3D points to 2D image plane
        img_points, _ = cv2.projectPoints(
            arrow_points,
            rvec,
            tvec,
            self.camera_matrix,
            self.dist_coeffs
        )
        img_points = img_points.astype(int).reshape(-1, 2)

        # Draw arrow (base to tip)
        image = cv2.arrowedLine(
            image,
            tuple(img_points[0]),  # Base
            tuple(img_points[1]),  # Tip
            (0, 255, 0),          # Green color
            thickness=3,
            tipLength=0.2
        )

        # Draw arrow wings
        image = cv2.line(image, tuple(img_points[1]), tuple(img_points[2]), (0, 255, 0), 2)
        image = cv2.line(image, tuple(img_points[1]), tuple(img_points[3]), (0, 255, 0), 2)

        # Add distance text
        cv2.putText(
            image,
            f"{int(distance)}m {direction}",
            (50, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (0, 255, 0),
            2
        )

        return image
    
    def analyze_ar_frame(self, current_frame_base64):
        """Analyze current camera frame for AR tracking and return frame with arrow"""
        if self.reference_descriptors is None:
            return {
                'success': False,
                'error': 'Reference landmark not set',
                'tracking_quality': 'poor'
            }

        # Convert current frame to image
        current_image = self.base64_to_image(current_frame_base64)
        
        # Extract features from current frame
        current_keypoints, current_descriptors = self.extract_features(
            current_image, use_sift=True
        )
        
        if current_descriptors is None or len(current_keypoints) < 50:
            return {
                'success': False,
                'error': 'No sufficient features detected in current frame',
                'tracking_quality': 'poor',
                'output_image': current_image
            }
        
        # Match features
        matches = self.match_features(
            self.reference_descriptors, 
            current_descriptors, 
            use_sift=True
        )
        
        if len(matches) < 10:
            return {
                'success': False,
                'error': f'Insufficient matches found: {len(matches)}',
                'tracking_quality': 'poor',
                'output_image': current_image
            }
        
        # Calculate homography
        homography, mask = self.calculate_homography(
            self.reference_keypoints, 
            current_keypoints, 
            matches
        )
        
        if homography is None:
            return {
                'success': False,
                'error': 'Could not calculate homography',
                'tracking_quality': 'poor',
                'output_image': current_image
            }
        
        # Estimate pose
        rvec, tvec, corners = self.estimate_pose_from_homography(
            homography, 
            self.reference_image.shape
        )
        
        if tvec is None:
            return {
                'success': False,
                'error': 'Could not estimate pose',
                'tracking_quality': 'poor',
                'output_image': current_image
            }
        
        # Calculate distance and angle
        distance, angle = self.calculate_distance_and_angle(tvec, rvec)
        
        # Convert distance from pixels to meters (rough estimation)
        distance_meters = distance * 0.1  # Rough conversion factor
        
        # Determine direction
        direction = 'right' if angle > 0 else 'left'
        
        # Draw navigation arrow
        output_image = self.draw_navigation_arrow(
            current_image, rvec, tvec, distance_meters, abs(angle), direction
        )

        # Determine tracking quality based on number of matches
        tracking_quality = 'good' if len(matches) > 20 else 'fair' if len(matches) > 10 else 'poor'

        return {
            'success': True,
            'distance': distance_meters,
            'angle': abs(angle),
            'direction': direction,
            'matches_count': len(matches),
            'homography_available': True,
            'pose_estimated': True,
            'tracking_quality': tracking_quality,
            'output_image': output_image
        }

class GoniometricCalculator:
    """
    Advanced goniometric calculations for AR navigation
    """
    
    def __init__(self):
        self.earth_radius = 6371000  # Earth radius in meters
    
    def calculate_bearing(self, lat1, lon1, lat2, lon2):
        """Calculate bearing between two GPS coordinates"""
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lon = math.radians(lon2 - lon1)
        
        y = math.sin(delta_lon) * math.cos(lat2_rad)
        x = (math.cos(lat1_rad) * math.sin(lat2_rad) - 
             math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon))
        
        bearing = math.atan2(y, x)
        return (math.degrees(bearing) + 360) % 360
    
    def calculate_distance_gps(self, lat1, lon1, lat2, lon2):
        """Calculate distance between two GPS coordinates using Haversine formula"""
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)
        
        a = (math.sin(delta_lat/2)**2 + 
             math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return self.earth_radius * c
    
    def triangulate_position(self, landmark_pos, user_pos, friend_bearing, user_bearing):
        """
        Triangulate friend's position using landmark as reference point
        """
        # Convert to radians
        friend_bearing_rad = math.radians(friend_bearing)
        user_bearing_rad = math.radians(user_bearing)
        
        # Calculate relative positions
        landmark_x, landmark_y = landmark_pos
        user_x, user_y = user_pos
        
        # Vector from landmark to friend
        friend_dx = math.cos(friend_bearing_rad)
        friend_dy = math.sin(friend_bearing_rad)
        
        # Vector from landmark to user
        user_dx = user_x - landmark_x
        user_dy = user_y - landmark_y
        
        # Calculate intersection point (friend's position)
        # This is a simplified 2D triangulation
        det = friend_dx * math.sin(user_bearing_rad) - friend_dy * math.cos(user_bearing_rad)
        
        if abs(det) < 1e-10:
            return None  # Lines are parallel
        
        t = (user_dx * math.sin(user_bearing_rad) - user_dy * math.cos(user_bearing_rad)) / det
        
        friend_x = landmark_x + t * friend_dx
        friend_y = landmark_y + t * friend_dy
        
        return (friend_x, friend_y)

class ARNavigationSystem:
    """
    Complete AR navigation system combining computer vision and goniometry
    """
    
    def __init__(self):
        self.tracker = ARLandmarkTracker()
        self.calculator = GoniometricCalculator()
        self.friend_position = None
        self.landmark_position = None
        
    def initialize_from_photos(self, friend_photo_base64, user_photo_base64):
        """Initialize the system with friend's and user's photos"""
        try:
            # Set reference landmark from friend's photo
            feature_count = self.tracker.set_reference_landmark(friend_photo_base64)
            
            # Analyze user's photo to establish baseline
            result = self.tracker.analyze_ar_frame(user_photo_base64)
            
            if not result['success']:
                return {
                    'success': False,
                    'error': f"Failed to analyze photos: {result.get('error', 'Unknown error')}"
                }
            
            return {
                'success': True,
                'feature_count': feature_count,
                'baseline_established': True,
                'matches_found': result.get('matches_count', 0)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Initialization failed: {str(e)}"
            }
    
    def process_ar_frame(self, current_frame_base64):
        """Process current AR frame and return navigation instructions with output image"""
        try:
            # Analyze current frame
            result = self.tracker.analyze_ar_frame(current_frame_base64)
            
            if not result['success']:
                return {
                    'success': False,
                    'error': result.get('error', 'Tracking lost'),
                    'tracking_quality': 'poor',
                    'matches_count': result.get('matches_count', 0)
                }
            
            # Generate navigation instructions
            distance = result['distance']
            angle = result['angle']
            direction = result['direction']
            
            # Create instruction text
            if distance < 5:
                instruction = f"You're very close! Look around for your friend."
            elif distance < 20:
                instruction = f"Walk {int(distance)}m {direction}, your friend should be nearby"
            else:
                instruction = f"Walk {int(distance)}m forward, then turn {int(angle)}° {direction}"
            
            # Convert output image to base64
            output_image = result.get('output_image')
            if output_image is not None:
                _, buffer = cv2.imencode('.jpg', output_image)
                output_image_base64 = base64.b64encode(buffer).decode('utf-8')
            else:
                output_image_base64 = None

            return {
                'success': True,
                'distance': distance,
                'angle': angle,
                'direction': direction,
                'instruction': instruction,
                'confidence': min(result.get('matches_count', 0) / 20.0, 1.0),
                'tracking_quality': result.get('tracking_quality', 'good'),
                'matches_count': result.get('matches_count', 0),
                'output_image_base64': output_image_base64
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"AR processing failed: {str(e)}",
                'tracking_quality': 'poor'
            }

# Example usage and testing
if __name__ == "__main__":
    # Initialize AR system
    ar_system = ARNavigationSystem()
    
    # Test with sample data
    print("AR Navigation System initialized")
    print("Ready for real-time landmark tracking and navigation")
