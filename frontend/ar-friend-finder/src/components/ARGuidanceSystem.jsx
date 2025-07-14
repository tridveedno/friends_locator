import React, { useState } from 'react';

const ARGuidanceSystem = () => {
  const [friendPhoto, setFriendPhoto] = useState(null);
  const [userPhoto, setUserPhoto] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(null);
  const [navigationData, setNavigationData] = useState(null);
  const [error, setError] = useState(null);

  // Backend URL from the deployment guide
  const backendUrl = 'https://5000-isswhq3yrro3osud1js5b-645c1f16.manusvm.computer';

  const handleInitialize = async () => {
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
        setNavigationData(result);
        setError(null);
      } else {
        setError('Failed to initialize AR system');
      }
    } catch (err) {
      setError('Error connecting to backend');
    }
  };

  const handleTrack = async () => {
    try {
      const response = await fetch(`${backendUrl}/api/ar/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_frame: currentFrame }),
      });

      const result = await response.json();
      if (result.success) {
        setNavigationData(result);
        setError(null);
      } else {
        setError('Failed to track frame');
      }
    } catch (err) {
      setError('Error connecting to backend');
    }
  };

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
          <p>Distance: {navigationData.distance || 'N/A'}</p>
          <p>Angle: {navigationData.angle || 'N/A'}</p>
          <p>Direction: {navigationData.direction || 'N/A'}</p>
        </div>
      )}
    </div>
  );
};

export default ARGuidanceSystem;