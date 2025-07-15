import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Navigation, X, Target, Wifi, WifiOff, Compass, MapPin, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';

const ARGuidanceSystem = ({ friendPhoto, onBack, onAnalysisComplete }) => {
  const [arResult, setArResult] = useState({
    success: false,
    distance: 50,
    angle: 0,
    direction: null,
    instruction: '',
    confidence: 0.5,
    matches_count: 0,
    tracking_quality: 'poor',
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [useFallbackMode, setUseFallbackMode] = useState(false);
  const [trackingQuality, setTrackingQuality] = useState('poor');
  const [error, setError] = useState(null);
  const [targetRotation, setTargetRotation] = useState(0);
  const [currentRotation, setCurrentRotation] = useState(0);
  const [arrowScale, setArrowScale] = useState(1.0);
  const [distanceOpacity, setDistanceOpacity] = useState(0.5);
  const [isARActive, setIsARActive] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [userPhoto, setUserPhoto] = useState(null);
  const [forceStandardMode, setForceStandardMode] = useState(false);
  const videoRef = useRef(null);
  const arCanvasRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastProcessTime = useRef(0);
  const processingInterval = 1000;

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://8ad734a7f05d.ngrok-free.app';

  const resizeImage = (imageSrc, maxWidth, maxHeight, callback) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = width * ratio;
        height = height * ratio;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const resizedData = canvas.toDataURL('image/jpeg', 0.2);
      console.log('Resized image dimensions:', width, 'x', height, 'Size:', resizedData.length, 'bytes');
      callback(resizedData);
    };
    img.onerror = () => {
      console.error('Failed to load image for resizing');
      callback(null);
    };
    img.src = imageSrc;
  };

  const handleUserPhotoUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setError('No user photo selected');
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Please upload a JPEG or PNG user photo');
      return;
    }
    if (file.size > 500000) {
      setError('User photo too large. Please upload an image under 500KB');
      console.error('Upload rejected: File size', file.size, 'bytes');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result;
      console.log('Uploaded user photo size:', base64String.length, 'bytes, Preview:', base64String.substring(0, 50));
      resizeImage(base64String, 320, 240, (resizedData) => {
        if (resizedData) {
          setUserPhoto(resizedData);
          console.log('Resized user photo size:', resizedData.length, 'bytes');
        } else {
          setError('Failed to resize user photo');
        }
      });
    };
    reader.onerror = () => setError('Failed to read user photo');
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const setupVideo = async () => {
      if (!videoRef.current) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setIsARActive(true);
          console.log('✅ Camera stream started successfully');
        };
      } catch (err) {
        console.error('Video stream error:', err.name, err.message);
        setError('Failed to access camera. Please upload a user photo or switch to standard mode.');
        setForceStandardMode(true);
      }
    };

    if (!userPhoto && !forceStandardMode) setupVideo();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject;
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [userPhoto, forceStandardMode]);

  useEffect(() => {
    if (friendPhoto && !isInitialized && (videoRef.current || userPhoto || forceStandardMode)) {
      initializeARSystem();
    }
    return () => cleanupAR();
  }, [friendPhoto, userPhoto, isInitialized, forceStandardMode]);

  const waitForCameraReady = async () => {
    if (userPhoto || forceStandardMode) return;
    let attempts = 0;
    while (
      (!videoRef.current || videoRef.current.videoWidth === 0) &&
      attempts < 10
    ) {
      console.log('⏳ Waiting for camera to be ready...');
      await new Promise(res => setTimeout(res, 300));
      attempts++;
    }
    if (!videoRef.current || videoRef.current.videoWidth === 0) {
      console.error('Camera not ready after 10 attempts');
      throw new Error('Camera not ready');
    }
  };

  const captureCurrentFrame = () => {
    if (userPhoto) {
      console.log('Using uploaded user photo:', userPhoto.substring(0, 50));
      return userPhoto;
    }
    if (!videoRef.current || !canvasRef.current) {
      console.error('captureCurrentFrame: videoRef or canvasRef missing', {
        videoRef: !!videoRef.current,
        canvasRef: !!canvasRef.current,
      });
      return null;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.error('Camera not ready — video dimensions are zero');
      return null;
    }

    canvas.width = Math.min(video.videoWidth, 320); // Reduced from 480
    canvas.height = Math.min(video.videoHeight, 240); // Reduced from 360

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg', 0.2); // Lowered quality from 0.3
    console.log('✅ Captured frame length:', imageData.length, 'bytes, Dimensions:', canvas.width, 'x', canvas.height);
    return imageData.startsWith('data:image') ? imageData : null;
  };

  const initializeARSystem = async () => {
    if (!friendPhoto) {
      console.error('Skipping initialization: friendPhoto missing');
      setError('Please upload a friend photo before starting');
      setUseFallbackMode(true);
      return;
    }

    setIsProcessing(true);

    try {
      if (!userPhoto && !forceStandardMode) await waitForCameraReady();
      let initialFrame = captureCurrentFrame();
      let attempts = 0;

      while ((!initialFrame || initialFrame.length < 10000) && attempts < 5 && !userPhoto && !forceStandardMode) {
        console.log('⏳ Retrying captureCurrentFrame, attempt:', attempts + 1);
        await new Promise(res => setTimeout(res, 300));
        initialFrame = captureCurrentFrame();
        attempts++;
      }

      if (!initialFrame || !initialFrame.startsWith('data:image')) {
        console.error('Invalid initial frame:', initialFrame ? initialFrame.substring(0, 50) : 'null');
        throw new Error('Failed to capture valid initial frame');
      }

      if (friendPhoto.length > 1500000 || initialFrame.length > 1500000) {
        console.error('Image too large:', {
          friend_photo_length: friendPhoto.length,
          user_photo_length: initialFrame.length,
        });
        throw new Error('Images too large. Please use images under 1.1MB.');
      }

      console.log('Sending initialize request with:', {
        mode: forceStandardMode ? 'standard' : 'ar',
        friend_photo_length: friendPhoto.length,
        user_photo_length: initialFrame.length,
        friend_photo_preview: friendPhoto.substring(0, 50),
        user_photo_preview: initialFrame.substring(0, 50),
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${backendUrl}/api/ar/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friend_photo: friendPhoto,
          user_photo: initialFrame,
          mode: forceStandardMode ? 'standard' : 'ar',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      console.log('Initialize response status:', response.status, 'URL:', `${backendUrl}/api/ar/initialize`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Initialize response error:', errorText);
        throw new Error(`Backend error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('Initialize response:', result);

      if (result.success) {
        setIsInitialized(true);
        setTrackingQuality(result.tracking_quality || 'good');
        setUseFallbackMode(result.tracking_quality === 'standard');
        setArResult(result);
        if (result.tracking_quality !== 'standard') {
          startARTracking();
        }
      } else {
        throw new Error(result.error || 'Failed to initialize system');
      }
    } catch (error) {
      console.error('Initialization error:', error);
      if (error.name === 'AbortError') {
        setError('The request took too long. Please check your connection and try again.');
      } else {
        setError(`Initialization failed: ${error.message}`);
      }

      // Fallback: Try standard mode
      try {
        console.log('Attempting fallback initialization in standard mode');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${backendUrl}/api/ar/initialize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            friend_photo: friendPhoto,
            user_photo: userPhoto || friendPhoto,
            mode: 'standard',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        console.log('Fallback initialize response status:', response.status);
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Fallback initialize response error:', errorText);
          throw new Error(`Fallback backend error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Fallback initialize response:', result);
        if (result.success) {
          setIsInitialized(true);
          setTrackingQuality('standard');
          setUseFallbackMode(true);
          setArResult(result);
        } else {
          throw new Error(result.error || 'Standard mode initialization failed');
        }
      } catch (fallbackError) {
        console.error('Standard mode fallback failed:', fallbackError);
        if (fallbackError.name === 'AbortError') {
          setError('Standard mode request timed out. Please check your connection.');
        } else {
          setError(`Unable to initialize in standard mode: ${fallbackError.message}`);
        }
        // Last resort: Demo mode
        setUseFallbackMode(true);
        setIsInitialized(true);
        setTrackingQuality('poor');
        setArResult({
          success: true,
          distance: 25,
          angle: 0,
          direction: 'forward',
          instruction: 'Walk forward (Demo Mode)',
          confidence: 0.8,
          matches_count: 15,
          tracking_quality: 'poor',
        });
        startARTracking();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const startARTracking = () => {
    const processFrame = async () => {
      if (!isInitialized || (!videoRef.current && !userPhoto)) return;
      const currentTime = Date.now();
      if (currentTime - lastProcessTime.current < processingInterval) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }
      lastProcessTime.current = currentTime;
      setFrameCount(prev => prev + 1);
      try {
        let result;
        if (useFallbackMode && trackingQuality !== 'standard') {
          result = {
            success: true,
            distance: 25 + Math.sin(frameCount * 0.1) * 10,
            angle: 15 + Math.cos(frameCount * 0.05) * 20,
            direction: Math.sin(frameCount * 0.03) > 0 ? 'right' : 'left',
            instruction: 'Walk forward and follow the arrow (Fallback Mode)',
            confidence: 0.8 + Math.random() * 0.2,
            matches_count: 15 + Math.floor(Math.random() * 10),
            tracking_quality: 'fair',
          };
        } else {
          const currentFrame = captureCurrentFrame();
          if (!currentFrame) return;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const response = await fetch(`${backendUrl}/api/ar/track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_frame: currentFrame }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          console.log('Track response status:', response.status, 'URL:', `${backendUrl}/api/ar/track`);
          if (!response.ok) throw new Error(`Backend error: ${response.status}`);
          result = await response.json();
        }
        if (result.success) {
          setArResult(result);
          setTrackingQuality(result.tracking_quality || 'good');
          setError(null);
          updateArrowGuidance(result);
          drawAROverlays(result);
        } else {
          if (result.error && !result.error.includes('Insufficient matches')) {
            console.warn('Tracking warning:', result.error);
          }
          setTrackingQuality('poor');
          setDistanceOpacity(0.3);
        }
      } catch (error) {
        console.error('Frame processing error:', error);
        setError(`Tracking error: ${error.message}`);
        if (!useFallbackMode) {
          setUseFallbackMode(true);
          setTrackingQuality('fair');
          setArResult({
            success: true,
            distance: 25,
            angle: 0,
            direction: 'forward',
            instruction: 'Walk forward (Fallback Mode)',
            confidence: 0.8,
            matches_count: 15,
            tracking_quality: 'fair',
          });
        } else {
          setTrackingQuality('poor');
          setDistanceOpacity(0.3);
        }
      }
      animationFrameRef.current = requestAnimationFrame(processFrame);
    };
    animationFrameRef.current = requestAnimationFrame(processFrame);
  };

  const updateArrowGuidance = (result) => {
    if (!result || !result.direction) return;
    let rotation = 0;
    const distance = result.distance || 50;
    const angle = result.angle || 30;
    if (distance > 15) {
      if (result.direction === 'left') {
        rotation = -(angle * 0.8);
      } else if (result.direction === 'right') {
        rotation = angle * 0.8;
      }
    } else {
      if (result.direction === 'left') {
        rotation = -angle;
      } else if (result.direction === 'right') {
        rotation = angle;
      }
    }
    rotation = Math.max(-90, Math.min(90, rotation));
    setTargetRotation(rotation);
    setCurrentRotation(rotation);
    let scale = 1.0;
    if (distance < 10) {
      scale = 1.5;
    } else if (distance > 100) {
      scale = 0.8;
    }
    setArrowScale(scale);
    const confidence = result.confidence || 0.5;
    setDistanceOpacity(Math.max(0.5, confidence));
  };

  const drawAROverlays = (result) => {
    if (!arCanvasRef.current) {
      console.error('arCanvasRef is not defined in drawAROverlays');
      return;
    }
    const canvas = arCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTrackingIndicators(ctx, result);
    drawDistanceRings(ctx, result);
    drawConfidenceMeter(ctx, result);
  };

  const drawTrackingIndicators = (ctx, result) => {
    if (!result.matches_count) return;
    const centerX = ctx.canvas.width / 2;
    const centerY = ctx.canvas.height / 2;
    ctx.fillStyle = 'rgba(0, 255, 0, 0.6)';
    const numPoints = Math.min(result.matches_count, 20);
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const radius = 100 + Math.random() * 200;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  };

  const drawDistanceRings = (ctx, result) => {
    const centerX = ctx.canvas.width / 2;
    const centerY = ctx.canvas.height / 2;
    const distance = result.distance || 50;
    ctx.strokeStyle = 'rgba(255, 165, 0, 0.3)';
    ctx.lineWidth = 2;
    const maxRadius = Math.min(centerX, centerY) * 0.8;
    const numRings = 3;
    for (let i = 1; i <= numRings; i++) {
      const radius = (maxRadius / numRings) * i;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      const ringDistance = Math.round((distance / numRings) * i);
      ctx.fillText(`${ringDistance}m`, centerX, centerY - radius + 15);
    }
  };

  const drawConfidenceMeter = (ctx, result) => {
    const confidence = result.confidence || 0.5;
    const x = 20;
    const y = ctx.canvas.height - 60;
    const width = 100;
    const height = 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, width, height);
    const confidenceColor = confidence > 0.7 ? 'green' : confidence > 0.4 ? 'orange' : 'red';
    ctx.fillStyle = confidenceColor;
    ctx.fillRect(x, y, width * confidence, height);
    ctx.fillStyle = 'white';
    ctx.font = '10px Arial';
    ctx.fillText('Tracking Confidence', x, y - 5);
  };

  const handleRetry = () => {
    setArResult({
      success: false,
      distance: 50,
      angle: 0,
      direction: null,
      instruction: '',
      confidence: 0.5,
      matches_count: 0,
      tracking_quality: 'poor',
    });
    setIsProcessing(false);
    setError(null);
    setIsInitialized(false);
    setTrackingQuality('unknown');
    setFrameCount(0);
    setCurrentRotation(0);
    setTargetRotation(0);
    setUseFallbackMode(false);
    setTimeout(() => {
      initializeARSystem();
    }, 500);
  };

  const handleComplete = () => {
    if (arResult && onAnalysisComplete) {
      onAnalysisComplete({
        ...arResult,
        method: trackingQuality === 'standard' ? 'standard_analysis' : useFallbackMode ? 'fallback_ar_tracking' : 'advanced_ar_tracking',
        frame_count: frameCount,
        tracking_quality: trackingQuality,
      });
    }
  };

  const getTrackingStatusColor = () => {
    switch (trackingQuality) {
      case 'good':
      case 'standard':
        return 'bg-green-500';
      case 'fair':
        return 'bg-yellow-500';
      case 'poor':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getTrackingIcon = () => {
    switch (trackingQuality) {
      case 'good':
      case 'standard':
        return <Wifi className="w-3 h-3" />;
      case 'fair':
        return <Target className="w-3 h-3" />;
      case 'poor':
        return <WifiOff className="w-3 h-3" />;
      default:
        return <Eye className="w-3 h-3" />;
    }
  };

  const cleanupAR = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject;
      const tracks = stream.getTracks();
      tracks.forEach(track => track.stop());
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
        style={{ display: userPhoto || forceStandardMode ? 'none' : 'block' }}
      />
      <canvas
        ref={arCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 1 }}
      />
      <canvas ref={canvasRef} className="hidden" />
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center pointer-events-auto">
          <Button
            onClick={onBack}
            variant="outline"
            size="sm"
            className="bg-black/50 border-white/30 text-white hover:bg-black/70"
          >
            <X className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            {!isARActive && !userPhoto && !forceStandardMode && (
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleUserPhotoUpload}
                className="text-white text-sm bg-black/50 px-3 py-1 rounded-full"
              />
            )}
            <Button
              onClick={() => setForceStandardMode(!forceStandardMode)}
              variant="outline"
              size="sm"
              className="bg-black/50 border-white/30 text-white hover:bg-black/70"
            >
              {forceStandardMode ? 'Switch to AR Mode' : 'Switch to Standard Mode'}
            </Button>
            <div className="flex items-center bg-black/50 px-2 py-1 rounded-full">
              <div className={`w-2 h-2 rounded-full mr-2 ${getTrackingStatusColor()}`}></div>
              {getTrackingIcon()}
            </div>
            <div className="bg-black/50 px-3 py-1 rounded-full">
              <span className="text-white text-sm font-medium">
                {isProcessing
                  ? 'Initializing...'
                  : isInitialized
                  ? trackingQuality === 'standard'
                    ? 'Standard Analysis'
                    : useFallbackMode && trackingQuality !== 'standard'
                    ? 'AR Demo'
                    : 'AR Tracking'
                  : isARActive
                  ? 'Camera Ready'
                  : userPhoto
                  ? 'User Photo Ready'
                  : 'Starting...'}
              </span>
            </div>
          </div>
        </div>
        {arResult && isInitialized && !isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="relative transition-all duration-300 ease-out"
              style={{
                transform: `rotate(${currentRotation}deg) scale(${arrowScale})`,
                opacity: distanceOpacity,
              }}
            >
              <div className="absolute inset-0 bg-black/30 rounded-full p-6 transform translate-x-1 translate-y-1 blur-sm">
                <ArrowUp className="w-12 h-12 text-transparent" />
              </div>
              <div className="relative bg-gradient-to-b from-orange-400 to-orange-600 rounded-full p-6 shadow-2xl border-4 border-white/30">
                <ArrowUp className="w-12 h-12 text-white drop-shadow-lg" />
              </div>
              <div className="absolute inset-0 bg-orange-500/20 rounded-full animate-ping"></div>
              <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                <Compass className="w-6 h-6 text-white/80" />
              </div>
            </div>
          </div>
        )}
        {arResult && isInitialized && !isProcessing && (
          <div className="absolute bottom-20 left-4 right-4 pointer-events-auto">
            <div
              className="bg-gradient-to-t from-black/90 to-black/70 rounded-xl p-6 text-center backdrop-blur-md border border-white/20"
              style={{ opacity: distanceOpacity }}
            >
              <div className="flex items-center justify-center mb-3">
                <MapPin className="w-6 h-6 text-orange-400 mr-2" />
                <span className="text-white text-2xl font-bold">
                  {Math.round(arResult.distance)}m away
                </span>
              </div>
              <div className="text-white/90 text-base mb-4 leading-relaxed">
                {arResult.instruction}
              </div>
              <div className="flex justify-between items-center text-xs text-white/60 mb-4">
                <span>Tracking: {arResult.matches_count || 0} features</span>
                <span>Quality: {trackingQuality}</span>
                <span>Mode: {trackingQuality === 'standard' ? 'Standard' : useFallbackMode ? 'Demo' : 'Live'}</span>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={handleRetry}
                  variant="outline"
                  className="flex-1 bg-white/10 border-white/30 text-white hover:bg-white/20 transition-all"
                >
                  Recalibrate
                </Button>
                <Button
                  onClick={handleComplete}
                  className="flex-1 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white transition-all"
                >
                  Found Friend!
                </Button>
              </div>
            </div>
          </div>
        )}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-black/80 rounded-xl p-8 text-center border border-white/20">
              <div className="relative mb-6">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-orange-500 border-t-transparent mx-auto"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Navigation className="w-6 h-6 text-orange-400" />
                </div>
              </div>
              <div className="text-white text-xl font-semibold mb-3">
                {isInitialized ? 'Processing frame...' : 'Initializing system...'}
              </div>
              <div className="text-white/70 text-sm">
                {isInitialized ? 'Tracking landmarks in real-time' : 'Analyzing landmark features and calibrating'}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto backdrop-blur-sm">
            <div className="bg-red-900/90 rounded-xl p-6 text-center max-w-sm mx-4 border border-red-500/30">
              <div className="text-white text-lg font-semibold mb-3">
                System Error
              </div>
              <div className="text-white/90 text-sm mb-4 leading-relaxed">
                {error}
              </div>
              <Button
                onClick={() => {
                  setError(null);
                  handleRetry();
                }}
                className="bg-red-600 hover:bg-red-700 text-white w-full"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}
        {isARActive && !isInitialized && !isProcessing && !error && !forceStandardMode && (
          <div className="absolute bottom-20 left-4 right-4">
            <div className="bg-black/80 rounded-xl p-6 text-center backdrop-blur-sm border border-white/20">
              <div className="text-white text-base mb-3">
                Point your camera at the same landmark visible in your friend's photo
              </div>
              <div className="text-white/70 text-sm">
                The system will automatically detect and track the landmark for precise navigation
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ARGuidanceSystem;
