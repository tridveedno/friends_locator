import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Navigation, X, Target, Wifi, WifiOff, Compass, MapPin, Eye, AlertTriangle } from 'lucide-react';
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
  const [showCompressionPrompt, setShowCompressionPrompt] = useState(false);
  const [processedFriendPhoto, setProcessedFriendPhoto] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = useRef(null);
  const arCanvasRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastProcessTime = useRef(0);
  const processingInterval = 1000;
  const maxRetries = 2;
  const resultHistory = useRef([]); // Store recent results for smoothing

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://c8fe3e3e0653.ngrok-free.app';
  console.log('Backend URL:', backendUrl);

  const resizeImage = (imageSrc, maxWidth, maxHeight, quality, callback) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = width * ratio;
      height = height * ratio;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const resizedData = canvas.toDataURL('image/jpeg', quality);
      console.log('Resized image dimensions:', width, 'x', height, 'Source:', img.width, 'x', img.height, 'Size:', resizedData.length, 'bytes');
      callback(resizedData);
    };
    img.onerror = () => {
      console.error('Failed to load image for resizing');
      callback(null);
    };
    img.src = imageSrc;
  };

  useEffect(() => {
    if (friendPhoto) {
      resizeImage(friendPhoto, 320, 240, 0.05, (resizedData) => {
        if (resizedData) {
          setProcessedFriendPhoto(resizedData);
          console.log('Processed friend photo size:', resizedData.length, 'bytes');
        } else {
          setError('Failed to resize friend photo');
          setShowCompressionPrompt(true);
        }
      });
    }
  }, [friendPhoto]);

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
    if (file.size > 5000000) {
      setError(`User photo too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Please upload an image under 5MB.`);
      console.error('Upload rejected: File size', file.size, 'bytes');
      setShowCompressionPrompt(true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result;
      console.log('Uploaded user photo size:', base64String.length, 'bytes, Preview:', base64String.substring(0, 50));
      resizeImage(base64String, 320, 240, 0.05, (resizedData) => {
        if (resizedData) {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height).data;
            let sum = 0, sumSq = 0, count = imageData.length;
            for (let i = 0; i < count; i++) {
              sum += imageData[i];
              sumSq += imageData[i] * imageData[i];
            }
            const mean = sum / count;
            const variance = (sumSq / count) - (mean * mean);
            console.log('User photo quality: mean=', mean.toFixed(2), 'variance=', variance.toFixed(2));
            if (mean < 10 || variance < 100) {
              setError('User photo is too dark or lacks distinct features. Please upload a clearer image.');
              setShowCompressionPrompt(true);
              return;
            }
            setUserPhoto(resizedData);
            console.log('Resized user photo size:', resizedData.length, 'bytes');
          };
          img.src = resizedData;
        } else {
          setError('Failed to resize user photo');
        }
      });
    };
    reader.onerror = () => setError('Failed to read user photo');
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const setupVideo = async (attempt = 1, maxAttempts = 3) => {
      if (!videoRef.current || forceStandardMode) {
        console.log('Skipping video setup: forceStandardMode:', forceStandardMode, 'videoRef:', !!videoRef.current);
        return;
      }
      try {
        console.log(`Attempting camera setup, attempt ${attempt}/${maxAttempts}`);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setIsARActive(true);
          console.log('✅ Camera stream started successfully');
        };
      } catch (err) {
        console.error('Video stream error:', { name: err.name, message: err.message, attempt });
        if (attempt < maxAttempts) {
          console.log(`Retrying camera setup in 1s, attempt ${attempt + 1}/${maxAttempts}`);
          setTimeout(() => setupVideo(attempt + 1, maxAttempts), 1000);
        } else {
          setError('Failed to access camera. Please upload a photo or switch to standard mode.');
          setForceStandardMode(true);
        }
      }
    };

    if (!forceStandardMode && !userPhoto) {
      console.log('Starting camera setup for AR mode');
      setupVideo();
    }

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        console.log('Stopping video stream');
        const stream = videoRef.current.srcObject;
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [userPhoto, forceStandardMode]);

  useEffect(() => {
    if (processedFriendPhoto && !isInitialized && !forceStandardMode) {
      console.log('Initializing AR mode: processedFriendPhoto ready, forceStandardMode:', forceStandardMode);
      initializeARSystem();
    }
  }, [processedFriendPhoto, isInitialized, forceStandardMode]);

  useEffect(() => {
    if (processedFriendPhoto && userPhoto && !isInitialized && forceStandardMode) {
      console.log('Initializing Standard mode: processedFriendPhoto and userPhoto ready, forceStandardMode:', forceStandardMode);
      initializeARSystem();
    }
  }, [processedFriendPhoto, userPhoto, isInitialized, forceStandardMode]);

  const waitForCameraReady = async () => {
    if (forceStandardMode || userPhoto) {
      console.log('Skipping camera check for Standard mode or user photo');
      return;
    }
    let attempts = 0;
    while (
      (!videoRef.current || videoRef.current.videoWidth === 0) &&
      attempts < 10
    ) {
      console.log('⏳ Waiting for camera to be ready... attempt:', attempts + 1);
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

    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, sumSq = 0, count = imageData.length;
    for (let i = 0; i < count; i++) {
      sum += imageData[i];
      sumSq += imageData[i] * imageData[i];
    }
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    console.log('Captured frame quality: mean=', mean.toFixed(2), 'variance=', variance.toFixed(2));
    if (mean < 10 || variance < 100) {
      console.error('Captured frame too dark or lacks features');
      setError('Camera frame is too dark or lacks distinct features. Please point at a well-lit landmark.');
      return null;
    }
    const frameData = canvas.toDataURL('image/jpeg', 0.05);
    console.log('✅ Captured frame length:', frameData.length, 'bytes, Dimensions:', canvas.width, 'x', canvas.height);
    return frameData.startsWith('data:image') ? frameData : null;
  };

  const initializeARSystem = async () => {
    if (!processedFriendPhoto) {
      console.error('Skipping initialization: processedFriendPhoto missing');
      setError('Please upload a friend photo before starting');
      return;
    }

    if (forceStandardMode && !userPhoto) {
      console.error('Standard mode requires a user photo');
      setError('Please upload a user photo for standard mode analysis');
      return;
    }

    setIsProcessing(true);
    console.log('Initializing system with mode:', forceStandardMode ? 'standard' : 'ar', 'retryCount:', retryCount);

    try {
      let initialFrame = forceStandardMode ? userPhoto : captureCurrentFrame();
      if (!forceStandardMode) await waitForCameraReady();

      if (!initialFrame && !forceStandardMode) {
        let attempts = 0;
        while ((!initialFrame || initialFrame.length < 10000) && attempts < 5) {
          console.log('⏳ Retrying captureCurrentFrame, attempt:', attempts + 1);
          await new Promise(res => setTimeout(res, 300));
          initialFrame = captureCurrentFrame();
          attempts++;
        }
      }

      if (!initialFrame || !initialFrame.startsWith('data:image')) {
        console.error('Invalid initial frame:', initialFrame ? initialFrame.substring(0, 50) : 'null');
        throw new Error('Failed to capture valid initial frame');
      }

      if (processedFriendPhoto.length > 5000000 || initialFrame.length > 5000000) {
        console.error('Image too large:', {
          friend_photo_length: processedFriendPhoto.length,
          user_photo_length: initialFrame.length,
        });
        throw new Error(`Images too large (${(Math.max(processedFriendPhoto.length, initialFrame.length) / 1000000).toFixed(2)}MB). Please use images under 5MB.`);
      }

      console.log('Sending initialize request:', {
        mode: forceStandardMode ? 'standard' : 'ar',
        friend_photo_length: processedFriendPhoto.length,
        user_photo_length: initialFrame.length,
        friend_photo_preview: processedFriendPhoto.substring(0, 50),
        user_photo_preview: initialFrame.substring(0, 50),
        retry_count: retryCount,
        url: `${backendUrl}/api/ar/initialize`,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await fetch(`${backendUrl}/api/ar/initialize`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Origin': window.location.origin,
          },
          body: JSON.stringify({
            friend_photo: processedFriendPhoto,
            user_photo: initialFrame,
            mode: forceStandardMode ? 'standard' : 'ar',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError) {
        console.error('Fetch error details:', {
          error: fetchError.name,
          message: fetchError.message,
          url: `${backendUrl}/api/ar/initialize`,
          mode: forceStandardMode ? 'standard' : 'ar',
        });
        throw new Error(`Network error: ${fetchError.message}. Check if backend is running at ${backendUrl}.`);
      }

      console.log('Initialize response:', { status: response.status, url: `${backendUrl}/api/ar/initialize` });
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Initialize response error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: `${backendUrl}/api/ar/initialize`,
        });
        throw new Error(`Backend error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('Initialize response data:', JSON.stringify(result, null, 2));

      if (result.success) {
        setIsInitialized(true);
        setTrackingQuality(result.tracking_quality || 'good');
        setUseFallbackMode(false);
        setArResult(result);
        if (!forceStandardMode && result.tracking_quality !== 'standard') {
          console.log('Starting AR tracking');
          startARTracking();
        }
        if (forceStandardMode && result.matches_count < 10 && retryCount < maxRetries) {
          setError('Low landmark matches. Please upload new photos with clearer or similar landmarks.');
          setTrackingQuality('poor');
          setArResult({
            ...result,
            instruction: result.instruction || 'No clear direction, please upload new photos',
            confidence: 0.3,
            tracking_quality: 'poor',
          });
          setRetryCount(prev => prev + 1);
          setTimeout(() => {
            setIsInitialized(false);
            setError(null);
          }, 5000);
        }
      } else {
        throw new Error(result.error || 'Failed to initialize system');
      }
    } catch (error) {
      console.error('Initialization error:', {
        message: error.message,
        url: backendUrl,
        mode: forceStandardMode ? 'standard' : 'ar',
      });
      setError(`Failed to initialize ${forceStandardMode ? 'Standard' : 'AR'} mode: ${error.message}`);
      if (retryCount < maxRetries) {
        setRetryCount(prev => prev + 1);
        setTimeout(() => {
          setIsInitialized(false);
          setError(null);
          console.log('Retrying initialization, attempt:', retryCount + 1);
          initializeARSystem();
        }, 2000);
      } else {
        setIsInitialized(true);
        setTrackingQuality('poor');
        setArResult({
          success: false,
          distance: 0,
          angle: 0,
          direction: null,
          instruction: `Failed to initialize: ${error.message}`,
          confidence: 0,
          matches_count: 0,
          tracking_quality: 'poor',
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const startARTracking = async () => {
    if (forceStandardMode) {
      console.log('Skipping AR tracking in Standard mode');
      return;
    }
    if (!videoRef.current || !isARActive) {
      console.error('Cannot start AR tracking: videoRef or isARActive missing', {
        videoRef: !!videoRef.current,
        isARActive,
      });
      setError('Camera not available. Please switch to Standard mode or try again.');
      return;
    }

    const processFrame = async () => {
      if (!isInitialized || !videoRef.current) {
        console.warn('Stopping AR tracking: not initialized or videoRef missing');
        return;
      }
      const currentTime = Date.now();
      if (currentTime - lastProcessTime.current < processingInterval) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }
      lastProcessTime.current = currentTime;
      setFrameCount(prev => prev + 1);
      try {
        const currentFrame = captureCurrentFrame();
        if (!currentFrame) {
          console.error('Failed to capture frame for tracking');
          throw new Error('No valid frame captured');
        }

        console.log('Sending track request:', {
          frame_length: currentFrame.length,
          frame_preview: currentFrame.substring(0, 50),
          url: `${backendUrl}/api/ar/track`,
          frame_count: frameCount,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch(`${backendUrl}/api/ar/track`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Origin': window.location.origin,
            },
            body: JSON.stringify({ current_frame: currentFrame }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
        } catch (fetchError) {
          console.error('Track fetch error:', {
            error: fetchError.name,
            message: fetchError.message,
            url: `${backendUrl}/api/ar/track`,
          });
          throw new Error(`Tracking error: ${fetchError.message}`);
        }

        console.log('Track response:', { status: response.status, url: `${backendUrl}/api/ar/track` });
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Track response error:', {
            status: response.status,
            statusText: response.statusText,
            body: errorText,
            url: `${backendUrl}/api/ar/track`,
          });
          throw new Error(`Backend error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Track response data:', JSON.stringify(result, null, 2));

        if (result.success) {
          // Smooth results
          resultHistory.current.push({
            distance: result.distance,
            angle: result.angle,
            direction: result.direction,
            confidence: result.confidence
          });
          if (resultHistory.current.length > 5) resultHistory.current.shift();

          const smoothedResult = {
            ...result,
            distance: resultHistory.current.reduce((sum, r) => sum + r.distance, 0) / resultHistory.current.length,
            angle: resultHistory.current.reduce((sum, r) => sum + r.angle, 0) / resultHistory.current.length,
            direction: resultHistory.current[resultHistory.current.length - 1].direction,
            confidence: resultHistory.current.reduce((sum, r) => sum + r.confidence, 0) / resultHistory.current.length,
            instruction: `Turn ${result.direction} ${Math.round(resultHistory.current.reduce((sum, r) => sum + r.angle, 0) / resultHistory.current.length)} degrees and walk ${Math.round(resultHistory.current.reduce((sum, r) => sum + r.distance, 0) / resultHistory.current.length)} meters toward the landmark`
          };

          setArResult(smoothedResult);
          setTrackingQuality(smoothedResult.tracking_quality || 'good');
          setError(null);
          setUseFallbackMode(false);
          updateArrowGuidance(smoothedResult);
          drawAROverlays(smoothedResult);
        } else {
          throw new Error(result.error || 'Tracking failed');
        }
      } catch (error) {
        console.error('Frame processing error:', {
          message: error.message,
          url: backendUrl,
          frame_count: frameCount,
        });
        setError(`AR tracking error: ${error.message}`);
        setTrackingQuality('poor');
        setDistanceOpacity(0.3);
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
    if (!result.matches_count || forceStandardMode) return;
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
    console.log('Retry triggered, resetting state');
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
    setShowCompressionPrompt(false);
    setIsInitialized(false);
    setTrackingQuality('unknown');
    setFrameCount(0);
    setCurrentRotation(0);
    setTargetRotation(0);
    setUseFallbackMode(false);
    setRetryCount(0);
    resultHistory.current = [];
    setTimeout(() => {
      console.log('Retrying initializeARSystem with forceStandardMode:', forceStandardMode);
      initializeARSystem();
    }, 500);
  };

  const handleComplete = () => {
    if (arResult && onAnalysisComplete) {
      onAnalysisComplete({
        ...arResult,
        method: trackingQuality === 'standard' ? 'standard_analysis' : 'advanced_ar_tracking',
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
      console.log('Cleaning up AR tracking');
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (videoRef.current && videoRef.current.srcObject) {
      console.log('Stopping video stream');
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
        style={{ display: forceStandardMode ? 'none' : userPhoto ? 'none' : 'block' }}
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
            {(forceStandardMode || !isARActive) && !userPhoto && (
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleUserPhotoUpload}
                className="text-white text-sm bg-black/50 px-3 py-1 rounded-full"
              />
            )}
            <Button
              onClick={() => {
                console.log('Switch mode button clicked, current forceStandardMode:', forceStandardMode, 'new value:', !forceStandardMode);
                setForceStandardMode(!forceStandardMode);
                setIsInitialized(false);
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
                setRetryCount(0);
                resultHistory.current = [];
                cleanupAR();
              }}
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
                  ? forceStandardMode
                    ? 'Standard Mode Active'
                    : trackingQuality === 'standard'
                    ? 'Standard Analysis'
                    : 'AR Tracking'
                  : forceStandardMode
                  ? 'Standard Mode Ready'
                  : isARActive
                  ? 'Camera Ready'
                  : userPhoto
                  ? 'User Photo Ready'
                  : 'Starting...'}
              </span>
            </div>
          </div>
        </div>
        {forceStandardMode && processedFriendPhoto && userPhoto && (
          <div className="absolute top-20 left-4 right-4 flex gap-2 pointer-events-none">
            <img
              src={processedFriendPhoto}
              alt="Friend's photo"
              className="w-24 h-18 object-cover rounded-md border border-white/30"
            />
            <img
              src={userPhoto}
              alt="Your photo"
              className="w-24 h-18 object-cover rounded-md border border-white/30"
            />
          </div>
        )}
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
                  {Math.round(arResult.distance)}m to landmark
                </span>
              </div>
              <div className="text-white/90 text-base mb-4 leading-relaxed">
                {arResult.instruction}
              </div>
              <div className="flex justify-between items-center text-xs text-white/60 mb-4">
                <span>Tracking: {arResult.matches_count || 0} features</span>
                <span>Quality: {trackingQuality}</span>
                <span>Mode: {forceStandardMode ? 'Standard' : 'Live'}</span>
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
                {isInitialized ? 'Processing frame...' : forceStandardMode ? 'Analyzing photos...' : 'Initializing system...'}
              </div>
              <div className="text-white/70 text-sm">
                {isInitialized
                  ? 'Tracking landmarks in real-time'
                  : forceStandardMode
                  ? 'Comparing your photo with friend’s photo'
                  : 'Analyzing landmark features to guide you to the landmark'}
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
              {showCompressionPrompt && (
                <div className="text-white/90 text-sm mb-4 leading-relaxed">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 inline-block mr-2" />
                  Your image is too large or lacks features. For iPhone users, try saving photos in "Most Compatible" format (Settings > Camera > Formats) or compress to under 5MB using{' '}
                  <a
                    href="https://tinyjpg.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline"
                  >
                    TinyJPG
                  </a>.
                </div>
              )}
              <Button
                onClick={() => {
                  setError(null);
                  setShowCompressionPrompt(false);
                  handleRetry();
                }}
                className="bg-red-600 hover:bg-red-700 text-white w-full"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}
        {forceStandardMode && !userPhoto && !isInitialized && !isProcessing && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
            <div className="bg-black/80 rounded-xl p-6 text-center max-w-sm mx-4 border border-white/20">
              <div className="text-white text-lg font-semibold mb-3">
                Upload Your Photo
              </div>
              <div className="text-white/90 text-sm mb-4 leading-relaxed">
                Please upload a photo of the same landmark as your friend’s photo to find the direction to it.
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleUserPhotoUpload}
                className="text-white text-sm bg-black/50 px-3 py-1 rounded-full w-full"
              />
            </div>
          </div>
        )}
        {!forceStandardMode && isARActive && !isInitialized && !isProcessing && !error && (
          <div className="absolute bottom-20 left-4 right-4">
            <div className="bg-black/80 rounded-xl p-6 text-center backdrop-blur-sm border border-white/20">
              <div className="text-white text-base mb-3">
                Point your camera at the same landmark visible in your friend's photo
              </div>
              <div className="text-white/70 text-sm">
                For best results, use a well-lit area with distinct landmarks to guide you to the landmark's location.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ARGuidanceSystem;
