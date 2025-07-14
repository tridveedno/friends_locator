import React, { useState, useEffect, useRef } from 'react';

const ARGuidanceSystem = () => {
  const [friendPhoto, setFriendPhoto] = useState(null);
  const [userPhoto, setUserPhoto] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(null);
  const [navigationData, setNavigationData] = useState(null);
  const [error, setError] = useState(null);
  const [outputImage, setOutputImage] = useState(null);
  const [trackingQuality, setTrackingQuality] = useState('N/A');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  // Replace with your Render backend URL
  const backendUrl = 'https://friends-locator-web.onrender.com'; // Verify this is your backend URL

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, // Use rear camera on mobile
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      setError('Failed to access camera: ' + err.message);
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsCameraActive(false);
    }
  };

  // Capture frame from video
  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = canvas.toDataURL('image/jpeg');
      setCurrentFrame(frame);
      return frame;
    }
    return null;
  };

  // Initialize AR system
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
        // Start camera after successful initialization
        startCamera();
      } else {
        setError(result.error || 'Failed to initialize AR system');
      }
    } catch (err) {
      setError('Error connecting to backend: ' + err.message);
    }
  };

  // Track frame periodically
  useEffect(() => {
    let interval;
    if (isCameraActive) {
      interval = setInterval(async () => {
        const frame = captureFrame();
        if (frame) {
          try {
            const response = await fetch(`${backendUrl}/api/ar/track`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ current_frame: frame }),
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
        }
      }, 1000); // Track every 1 second
    }

    return () => clearInterval(interval);
  }, [isCameraActive]);

  // Handle file uploads
  const handleFileUpload = (event, type) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (type === 'friend') setFriendPhoto(reader.result);
        else if (type === 'user') setUserPhoto(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div style={{
      maxWidth: '800px',
      margin: '0 auto',
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f0f0f0',
      minHeight: '100vh',
    }}>
      <h2 style={{ textAlign: 'center', color: '#333' }}>AR Friend Finder</h2>
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>Friend's Photo:</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleFileUpload(e, 'friend')}
          style={{ width: '100%' }}
        />
      </div>
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>User's Photo:</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handleFileUpload(e, 'user')}
          style={{ width: '100%' }}
        />
      </div>
      <button
        onClick={handleInitialize}
        style={{
          padding: '10px 20px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          marginBottom: '20px',
          width: '100%',
        }}
      >
        Initialize AR
      </button>
      {isCameraActive && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ color: '#333' }}>Live Camera Feed</h3>
          <video
            ref={videoRef}
            autoPlay
            style={{ width: '100%', maxWidth: '600px', borderRadius: '5px' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <button
            onClick={stopCamera}
            style={{
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              marginTop: '10px',
              width: '100%',
            }}
          >
            Stop Camera
          </button>
        </div>
      )}
      {error && (
        <p style={{ color: 'red', textAlign: 'center', margin: '10px 0' }}>{error}</p>
      )}
      {navigationData && (
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '5px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}>
          <h3 style={{ color: '#333' }}>Navigation Data</h3>
          <p><strong>Instruction:</strong> {navigationData.instruction || 'N/A'}</p>
          <p><strong>Distance:</strong> {navigationData.distance ? `${navigationData.distance.toFixed(1)}m` : 'N/A'}</p>
          <p><strong>Angle:</strong> {navigationData.angle ? `${navigationData.angle.toFixed(1)}°` : 'N/A'}</p>
          <p><strong>Direction:</strong> {navigationData.direction || 'N/A'}</p>
          <p><strong>Confidence:</strong> {navigationData.confidence ? `${(navigationData.confidence * 100).toFixed(0)}%` : 'N/A'}</p>
          <p><strong>Tracking Quality:</strong> {trackingQuality}</p>
          <p><strong>Matches Found:</strong> {navigationData.matches_count || navigationData.feature_count || 'N/A'}</p>
          {outputImage && (
            <div>
              <h3 style={{ color: '#333' }}>AR Output</h3>
              <img
                src={outputImage}
                alt="AR Output"
                style={{ width: '100%', maxWidth: '600px', borderRadius: '5px' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ARGuidanceSystem;