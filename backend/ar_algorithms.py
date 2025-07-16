import cv2
import numpy as np
import logging

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s %(levelname)s: %(message)s',
    handlers=[
        logging.FileHandler('ar_algorithms.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def analyze_images_for_directions(friend_img, user_img, mode):
    logger.debug("Starting analyze_images_for_directions: mode=%s, friend_img_shape=%s, user_img_shape=%s",
                 mode, str(friend_img.shape), str(user_img.shape))
    try:
        # Validate images
        if friend_img is None or user_img is None:
            logger.error("Invalid images: friend_img=%s, user_img=%s",
                        friend_img is None, user_img is None)
            return {
                "success": False,
                "error": "One or both images are invalid",
                "matches_count": 0,
                "tracking_quality": "poor",
                "feature_count": {"friend": 0, "user": 0}
            }

        # Check image quality (mean intensity and variance)
        friend_mean = np.mean(friend_img)
        user_mean = np.mean(user_img)
        friend_var = np.var(friend_img)
        user_var = np.var(user_img)
        logger.debug("Image quality: friend_mean=%.2f, friend_var=%.2f, user_mean=%.2f, user_var=%.2f",
                    friend_mean, friend_var, user_mean, user_var)
        if user_mean < 10 or user_var < 100:
            logger.error("User image quality too low: mean=%.2f, variance=%.2f", user_mean, user_var)
            return {
                "success": False,
                "error": "User image is too dark or lacks features (mean intensity or variance too low)",
                "matches_count": 0,
                "tracking_quality": "poor",
                "feature_count": {"friend": 0, "user": 0}
            }

        # Convert to grayscale
        friend_gray = cv2.cvtColor(friend_img, cv2.COLOR_BGR2GRAY)
        user_gray = cv2.cvtColor(user_img, cv2.COLOR_BGR2GRAY)
        logger.debug("Converted images to grayscale")

        # Initialize ORB detector
        orb = cv2.ORB_create(nfeatures=2000)  # Increased for better detection
        keypoints1, descriptors1 = orb.detectAndCompute(friend_gray, None)
        keypoints2, descriptors2 = orb.detectAndCompute(user_gray, None)
        logger.debug("Detected keypoints: friend=%d, user=%d",
                    len(keypoints1) if keypoints1 else 0, len(keypoints2) if keypoints2 else 0)

        # Explicitly check for None or empty descriptors
        if (keypoints1 is None or descriptors1 is None or len(keypoints1) == 0 or
            keypoints2 is None or descriptors2 is None or len(keypoints2) == 0):
            logger.error("Insufficient keypoints: friend_keypoints=%d, user_keypoints=%d",
                        len(keypoints1) if keypoints1 else 0, len(keypoints2) if keypoints2 else 0)
            return {
                "success": False,
                "error": "Insufficient keypoints detected in one or both images",
                "matches_count": 0,
                "tracking_quality": "poor",
                "feature_count": {"friend": len(keypoints1) if keypoints1 else 0, "user": len(keypoints2) if keypoints2 else 0}
            }

        # Match descriptors using BFMatcher
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(descriptors1, descriptors2)
        matches = sorted(matches, key=lambda x: x.distance)
        logger.debug("Found %d matches", len(matches))

        if len(matches) < 10:
            logger.warning("Too few matches: %d", len(matches))
            return {
                "success": False,
                "error": f"Too few matches ({len(matches)}) to determine direction. Try clearer images with distinct landmarks.",
                "matches_count": len(matches),
                "tracking_quality": "poor",
                "feature_count": {"friend": len(keypoints1), "user": len(keypoints2)}
            }

        # Extract matched keypoints
        src_pts = np.float32([keypoints1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([keypoints2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)

        # Estimate homography
        H, _ = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        if H is None:
            logger.error("Homography estimation failed")
            return {
                "success": False,
                "error": "Failed to estimate homography",
                "matches_count": len(matches),
                "tracking_quality": "poor",
                "feature_count": {"friend": len(keypoints1), "user": len(keypoints2)}
            }

        # Calculate direction and distance
        if mode == "standard":
            angle = np.arctan2(H[0, 1], H[0, 0]) * 180 / np.pi
            direction = "right" if angle > 0 else "left"
            distance = np.abs(H[0, 2]) / 10.0  # Simplified distance estimation
            instruction = f"Turn {direction} {abs(round(angle))} degrees and walk {round(distance)} meters"
            tracking_quality = "standard" if len(matches) > 50 else "poor"
        else:
            angle = np.arctan2(H[0, 1], H[0, 0]) * 180 / np.pi
            direction = "right" if angle > 0 else "left"
            distance = np.abs(H[0, 2]) / 5.0  # Adjusted for AR
            instruction = f"Turn {direction} {abs(round(angle))} degrees and walk {round(distance)} meters"
            tracking_quality = "good" if len(matches) > 50 else "fair"

        logger.debug("Analysis result: instruction=%s, distance=%f, angle=%f, direction=%s, matches=%d, quality=%s",
                    instruction, distance, angle, direction, len(matches), tracking_quality)

        return {
            "success": True,
            "distance": distance,
            "angle": abs(round(angle)),
            "direction": direction,
            "instruction": instruction,
            "confidence": min(0.9, len(matches) / 100.0),
            "matches_count": len(matches),
            "tracking_quality": tracking_quality,
            "feature_count": {"friend": len(keypoints1), "user": len(keypoints2)}
        }

    except Exception as e:
        logger.error("Error in analyze_images_for_directions: %s", str(e))
        return {
            "success": False,
            "error": f"Analysis failed: {str(e)}",
            "matches_count": 0,
            "tracking_quality": "poor",
            "feature_count": {"friend": 0, "user": 0}
        }

def track_ar(current_frame):
    logger.debug("Starting track_ar: frame_shape=%s", str(current_frame.shape))
    try:
        # Validate frame
        if current_frame is None:
            logger.error("Invalid frame")
            return {
                "success": False,
                "error": "Invalid frame",
                "matches_count": 0,
                "tracking_quality": "poor",
                "feature_count": 0
            }

        # Check frame quality
        frame_mean = np.mean(current_frame)
        frame_var = np.var(current_frame)
        logger.debug("Frame quality: mean=%.2f, variance=%.2f", frame_mean, frame_var)
        if frame_mean < 10 or frame_var < 100:
            logger.error("Frame quality too low: mean=%.2f, variance=%.2f", frame_mean, frame_var)
            return {
                "success": False,
                "error": "Frame is too dark or lacks features (mean intensity or variance too low)",
                "matches_count": 0,
                "tracking_quality": "poor",
                "feature_count": 0
            }

        # Convert to grayscale
        frame_gray = cv2.cvtColor(current_frame, cv2.COLOR_BGR2GRAY)
        logger.debug("Converted frame to grayscale")

        # Initialize ORB detector
        orb = cv2.ORB_create(nfeatures=2000)
        keypoints, descriptors = orb.detectAndCompute(frame_gray, None)
        logger.debug("Detected keypoints: %d", len(keypoints) if keypoints else 0)

        if keypoints is None or descriptors is None or len(keypoints) == 0:
            logger.error("Insufficient keypoints in frame: %d", len(keypoints) if keypoints else 0)
            return {
                "success": False,
                "error": "Insufficient keypoints in frame",
                "matches_count": 0,
                "tracking_quality": "poor",
                "feature_count": len(keypoints) if keypoints else 0
            }

        # Simulate tracking (replace with actual tracking logic)
        matches = 50  # Placeholder for actual matching
        angle = np.random.uniform(-45, 45)
        direction = "right" if angle > 0 else "left"
        distance = np.random.uniform(5, 50)
        instruction = f"Turn {direction} {abs(round(angle))} degrees and walk {round(distance)} meters"
        tracking_quality = "good" if matches > 50 else "fair"

        logger.debug("Tracking result: instruction=%s, distance=%f, angle=%f, direction=%s, matches=%d, quality=%s",
                    instruction, distance, angle, direction, matches, tracking_quality)

        return {
            "success": True,
            "distance": distance,
            "angle": abs(round(angle)),
            "direction": direction,
            "instruction": instruction,
            "confidence": min(0.9, matches / 100.0),
            "matches_count": matches,
            "tracking_quality": tracking_quality,
            "feature_count": len(keypoints)
        }

    except Exception as e:
        logger.error("Error in track_ar: %s", str(e))
        return {
            "success": False,
            "error": f"Tracking failed: {str(e)}",
            "matches_count": 0,
            "tracking_quality": "poor",
            "feature_count": 0
        }
