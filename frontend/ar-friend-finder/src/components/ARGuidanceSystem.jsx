import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowUp, Navigation, X, Target, Wifi, WifiOff, Compass, MapPin, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';

const ARGuidanceSystem = ({ friendPhoto, onBack, onAnalysisComplete }) => {
  // ... existing state and ref declarations ...

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://162a64905feb.ngrok-free.app';
  console.log("Attempting to connect to backend at:", backendUrl);

  // ... existing useEffect, initializeAR, setupARCanvas, cleanupAR ...

  const initializeARSystem = async () => {
    if (!videoRef.current || !friendPhoto) return;
    setIsProcessing(true);
    try {
      const initialFrame = captureCurrentFrame();
      if (!initialFrame) throw new Error('Failed to capture initial frame');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${backendUrl}/api/ar/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friend_photo: friendPhoto,
          user_photo: initialFrame,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      console.log('Initialize response status:', response.status, 'URL:', `${backendUrl}/api/ar/initialize`);
      if (!response.ok) throw new Error(`Backend error: ${response.status}`);
      const result = await response.json();
      console.log('Initialize response:', result);
      if (result.success) {
        setIsInitialized(true);
        setTrackingQuality('good');
        setUseFallbackMode(false);
        setArResult(result); // Ensure arResult is set
        startARTracking();
      } else {
        throw new Error(result.error || 'Failed to initialize AR system');
      }
    } catch (error) {
      console.error('AR initialization error:', error);
      setError(`Initialization failed: ${error.message}`);
      setUseFallbackMode(true);
      setIsInitialized(true);
      setTrackingQuality('fair');
      setArResult({
        success: true,
        distance: 25,
        angle: 0,
        direction: 'forward',
        instruction: 'Walk forward (Demo Mode)',
        confidence: 0.8,
        matches_count: 15,
        tracking_quality: 'fair',
      });
      startARTracking();
    } finally {
      setIsProcessing(false);
    }
  };

  const startARTracking = () => {
    const processFrame = async () => {
      if (!isInitialized || !videoRef.current) return;
      const currentTime = Date.now();
      if (currentTime - lastProcessTime < processingInterval) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }
      setLastProcessTime(currentTime);
      setFrameCount(prev => prev + 1);
      try {
        let result;
        if (useFallbackMode) {
          result = {
            success: true,
            distance: 25 + Math.sin(frameCount * 0.1) * 10,
            angle: 15 + Math.cos(frameCount * 0.05) * 20,
            direction: Math.sin(frameCount * 0.03) > 0 ? 'right' : 'left',
            instruction: 'Walk forward and follow the arrow (Demo Mode)',
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
            instruction: 'Walk forward (Demo Mode)',
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
    if (!result || !result.direction) return; // Prevent undefined access
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
    if (!arCanvasRef.current) return
    
    const canvas = arCanvasRef.current
    const ctx = canvas.getContext('2d')
    
    // Clear previous overlays
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Draw tracking indicators
    drawTrackingIndicators(ctx, result)
    
    // Draw distance rings
    drawDistanceRings(ctx, result)
    
    // Draw confidence meter
    drawConfidenceMeter(ctx, result)
  }
  
  const drawTrackingIndicators = (ctx, result) => {
    if (!result.matches_count) return
    
    const centerX = ctx.canvas.width / 2
    const centerY = ctx.canvas.height / 2
    
    // Draw tracking points (simulated)
    ctx.fillStyle = 'rgba(0, 255, 0, 0.6)'
    const numPoints = Math.min(result.matches_count, 20)
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI
      const radius = 100 + Math.random() * 200
      const x = centerX + Math.cos(angle) * radius
      const y = centerY + Math.sin(angle) * radius
      
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
  
  const drawDistanceRings = (ctx, result) => {
    const centerX = ctx.canvas.width / 2
    const centerY = ctx.canvas.height / 2
    const distance = result.distance || 50
    
    // Draw concentric rings based on distance
    ctx.strokeStyle = 'rgba(255, 165, 0, 0.3)'
    ctx.lineWidth = 2
    
    const maxRadius = Math.min(centerX, centerY) * 0.8
    const numRings = 3
    
    for (let i = 1; i <= numRings; i++) {
      const radius = (maxRadius / numRings) * i
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
      ctx.stroke()
      
      // Add distance labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.font = '12px Arial'
      ctx.textAlign = 'center'
      const ringDistance = Math.round((distance / numRings) * i)
      ctx.fillText(`${ringDistance}m`, centerX, centerY - radius + 15)
    }
  }
  
  const drawConfidenceMeter = (ctx, result) => {
    const confidence = result.confidence || 0.5
    const x = 20
    const y = ctx.canvas.height - 60
    const width = 100
    const height = 10
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(x, y, width, height)
    
    // Confidence bar
    const confidenceColor = confidence > 0.7 ? 'green' : confidence > 0.4 ? 'orange' : 'red'
    ctx.fillStyle = confidenceColor
    ctx.fillRect(x, y, width * confidence, height)
    
    // Label
    ctx.fillStyle = 'white'
    ctx.font = '10px Arial'
    ctx.fillText('Tracking Confidence', x, y - 5)
  }
  
  const handleRetry = () => {
    setArResult(null)
    setIsProcessing(false)
    setError(null)
    setIsInitialized(false)
    setTrackingQuality('unknown')
    setFrameCount(0)
    setCurrentRotation(0)
    setTargetRotation(0)
    setUseFallbackMode(false)
    
    setTimeout(() => {
      initializeARSystem()
    }, 500)
  }

  const handleComplete = () => {
    if (arResult && onAnalysisComplete) {
      onAnalysisComplete({
        ...arResult,
        method: useFallbackMode ? 'fallback_ar_tracking' : 'advanced_ar_tracking',
        frame_count: frameCount,
        tracking_quality: trackingQuality
      })
    }
  }
  
  const getTrackingStatusColor = () => {
    switch (trackingQuality) {
      case 'good': return 'bg-green-500'
      case 'fair': return 'bg-yellow-500'
      case 'poor': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }
  
  const getTrackingIcon = () => {
    switch (trackingQuality) {
      case 'good': return <Wifi className="w-3 h-3" />
      case 'fair': return <Target className="w-3 h-3" />
      case 'poor': return <WifiOff className="w-3 h-3" />
      default: return <Eye className="w-3 h-3" />
    }
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Camera Feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />
      
      {/* AR Overlay Canvas */}
      <canvas
        ref={arCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 1 }}
      />
      
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* UI Overlay Container */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
        {/* Top UI Bar */}
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
            {/* Tracking Quality Indicator */}
            <div className="flex items-center bg-black/50 px-2 py-1 rounded-full">
              <div className={`w-2 h-2 rounded-full mr-2 ${getTrackingStatusColor()}`}></div>
              {getTrackingIcon()}
            </div>
            
            {/* Status */}
            <div className="bg-black/50 px-3 py-1 rounded-full">
              <span className="text-white text-sm font-medium">
                {isProcessing ? 'Initializing...' : 
                 isInitialized ? (useFallbackMode ? 'AR Demo' : 'AR Tracking') : 
                 isARActive ? 'Camera Ready' : 'Starting...'}
              </span>
            </div>
          </div>
        </div>

        {/* Main AR Navigation Overlay */}
        {arResult && isInitialized && !isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* 3D-style Directional Arrow */}
            <div 
              className="relative transition-all duration-300 ease-out"
              style={{
                transform: `rotate(${currentRotation}deg) scale(${arrowScale})`,
                opacity: distanceOpacity
              }}
            >
              {/* Arrow shadow for 3D effect */}
              <div className="absolute inset-0 bg-black/30 rounded-full p-6 transform translate-x-1 translate-y-1 blur-sm">
                <ArrowUp className="w-12 h-12 text-transparent" />
              </div>
              
              {/* Main arrow */}
              <div className="relative bg-gradient-to-b from-orange-400 to-orange-600 rounded-full p-6 shadow-2xl border-4 border-white/30">
                <ArrowUp className="w-12 h-12 text-white drop-shadow-lg" />
              </div>
              
              {/* Pulse effect for attention */}
              <div className="absolute inset-0 bg-orange-500/20 rounded-full animate-ping"></div>
              
              {/* Direction indicator */}
              <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                <Compass className="w-6 h-6 text-white/80" />
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Distance and Instruction Overlay */}
        {arResult && isInitialized && !isProcessing && (
          <div className="absolute bottom-20 left-4 right-4 pointer-events-auto">
            <div 
              className="bg-gradient-to-t from-black/90 to-black/70 rounded-xl p-6 text-center backdrop-blur-md border border-white/20"
              style={{ opacity: distanceOpacity }}
            >
              {/* Distance display with icon */}
              <div className="flex items-center justify-center mb-3">
                <MapPin className="w-6 h-6 text-orange-400 mr-2" />
                <span className="text-white text-2xl font-bold">
                  {Math.round(arResult.distance)}m away
                </span>
              </div>
              
              {/* Instruction text */}
              <div className="text-white/90 text-base mb-4 leading-relaxed">
                {arResult.instruction}
              </div>
              
              {/* Technical info and quality indicators */}
              <div className="flex justify-between items-center text-xs text-white/60 mb-4">
                <span>Tracking: {arResult.matches_count || 0} features</span>
                <span>Quality: {trackingQuality}</span>
                <span>Mode: {useFallbackMode ? 'Demo' : 'Live'}</span>
              </div>
              
              {/* Action buttons */}
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

        {/* Enhanced Processing Overlay */}
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
                {isInitialized ? 'Processing frame...' : 'Initializing AR system...'}
              </div>
              <div className="text-white/70 text-sm">
                {isInitialized ? 'Tracking landmarks in real-time' : 'Analyzing landmark features and calibrating'}
              </div>
            </div>
          </div>
        )}

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto backdrop-blur-sm">
            <div className="bg-red-900/90 rounded-xl p-6 text-center max-w-sm mx-4 border border-red-500/30">
              <div className="text-white text-lg font-semibold mb-3">
                AR System Error
              </div>
              <div className="text-white/90 text-sm mb-4 leading-relaxed">
                {error}
              </div>
              <Button
                onClick={() => {
                  setError(null)
                  handleRetry()
                }}
                className="bg-red-600 hover:bg-red-700 text-white w-full"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Instructions for first-time users */}
        {isARActive && !isInitialized && !isProcessing && !error && (
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
  )
}

export default ARGuidanceSystem

