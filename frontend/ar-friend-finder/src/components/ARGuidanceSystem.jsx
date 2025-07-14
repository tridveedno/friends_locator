import React, { useState, useEffect } from 'react';

const ARGuidanceSystem = () => {
  const [friendPhoto, setFriendPhoto] = useState(null);
  const [userPhoto, setUserPhoto] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(null);
  const [navigationData, setNavigationData] = useState(null);
  const [error, setError] = useState(null);
  const [outputImage, setOutputImage] = useState(null);
  const [trackingQuality, setTrackingQuality] = useState('N/A');

  // Replace with your Render backend URL
  const backendUrl = 'https://friends-locator-web.onrender.com'; // Update this with your actual Render backend URL

  const handleInitialize = async () => {
    if (!friendPhoto || !userPhoto) {
      setError('Please upload both friend and user photos');
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/ar/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friend_photo: friendPhoto,
          user_photo: userPhoto,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setNavigationData({
          feature_count: result.feature_count,
          baseline_established: result.baseline_established,
          matches_found: result.matches_found,
        });
        setError(null);
      } else {
        setError(result.error || 'Failed to initialize AR system');
      }
    } catch (err) {
      setError('Error connecting to backend: ' + err.message);
    }
  };

  const handleTrack = async () => {
    if (!currentFrame) {
      setError('Please capture a current frame');
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/ar/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_frame: currentFrame }),
      });

      const result = await response.json();
      if (result.success) {
        setNavigationData({
          distance: result.distance,
          angle: result.angle,
          direction: result.direction,
          instruction: result.instruction,
          confidence: result.confidence,
          tracking_quality: result.tracking_quality,
          matches_count: result.matches_count,
        });
        setOutputImage(result.output_image_base64 || null);
        setTrackingQuality(result.tracking_quality || 'N/A');
        setError(null);
      } else {
        setError(result.error || 'Failed to track frame');
        setTrackingQuality(result.tracking_quality || 'poor');
        setOutputImage(result.output_image_base64 || null);
      }
    } catch (err) {
      setError('Error connecting to backend: ' + err.message);
    }
  };

  // Example handler for file uploads
  const handleFileUpload = (event, type) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (type === 'friend') setFriendPhoto(reader.result);
        else if (type === 'user') setUserPhoto(reader.result);
        else if (type === 'frame') setCurrentFrame(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="ar-guidance-system">
      <h2>AR Friend Finder</h2>
      <div>
        <label>Friend's Photo:</label>
        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'friend')} />
      </div>
      <div>
        <label>User's Photo:</label>
        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'user')} />
      </div>
      <button onClick={handleInitialize}>Initialize AR</button>
      <div>
        <label>Current Frame:</label>
        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'frame')} />
      </div>
      <button onClick={handleTrack}>Track Frame</button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {navigationData && (
        <div>
          <h3>Navigation Data</h3>
          <p>Instruction: {navigationData.instruction || 'N/A'}</p>
          <p>Distance: {navigationData.distance ? `${navigationData.distance.toFixed(1)}m` : 'N/A'}</p>
          <p>Angle: {navigationData.angle ? `${navigationData.angle.toFixed(1)}°` : 'N/A'}</p>
          <p>Direction: {navigationData.direction || 'N/A'}</p>
          <p>Confidence: {navigationData.confidence ? (navigationData.confidence * 100).toFixed(0) + '%' : 'N/A'}</p>
          <p>Tracking Quality: {trackingQuality}</p>
          <p>Matches Found: {navigationData.matches_count || navigationData.feature_count || 'N/A'}</p>
          {outputImage && (
            <div>
              <h3>AR Output</h3>
              <img src={outputImage} alt="AR Output" style={{ maxWidth: '100%' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ARGuidanceSystem;