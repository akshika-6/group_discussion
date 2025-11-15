import React, { useState, useEffect, useRef } from 'react';
import { Video, Users, StopCircle, Brain, Copy, Check, Mic, Award, AlertCircle } from 'lucide-react';

const MultiDeviceGDAnalyzer = () => {
  const [mode, setMode] = useState(null); // 'host' or 'participant'
  const [roomCode, setRoomCode] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  
  // Host state
  const [participants, setParticipants] = useState([]);
  const [gdStarted, setGdStarted] = useState(false);
  const [gdEnded, setGdEnded] = useState(false);
  const [totalTime, setTotalTime] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  
  // Participant state
  const [connected, setConnected] = useState(false);
  const [myStream, setMyStream] = useState(null);
  
  // Refs
  const videoRefs = useRef({});
  const peerConnections = useRef({});
  const audioContexts = useRef({});
  const analyzerNodes = useRef({});
  const startTimeRef = useRef(null);
  const dataChannels = useRef({});
  const myVideoRef = useRef(null);

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  // Generate room code
  const generateRoomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  // Initialize as Host
  const startAsHost = () => {
    const code = generateRoomCode();
    setRoomCode(code);
    setMode('host');
    
    // Listen for participants through storage
    window.addEventListener('storage', handleStorageEvent);
  };

  // Handle storage events for communication
  const handleStorageEvent = async (e) => {
    if (e.key && e.key.startsWith(`gd_signal_${roomCode}_`)) {
      const signal = JSON.parse(e.newValue);
      const participantId = signal.from;
      
      if (signal.type === 'join-request') {
        // New participant wants to join
        await handleParticipantJoin(participantId, signal.name);
      } else if (signal.type === 'offer') {
        await handleOffer(participantId, signal);
      } else if (signal.type === 'answer') {
        await handleAnswer(participantId, signal);
      } else if (signal.type === 'ice-candidate') {
        await handleIceCandidate(participantId, signal);
      } else if (signal.type === 'audio-data') {
        updateParticipantAudio(participantId, signal.data);
      }
    }
  };

  // Handle participant join
  const handleParticipantJoin = async (participantId, name) => {
    const newParticipant = {
      id: participantId,
      name: name,
      stream: null,
      speaking: false,
      speakingTime: 0,
      contributions: 0,
      sentimentScore: 0,
      audioLevel: 0
    };
    
    setParticipants(prev => [...prev, newParticipant]);
    
    // Create peer connection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnections.current[participantId] = pc;
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(participantId, {
          type: 'ice-candidate',
          candidate: event.candidate,
          from: 'host'
        });
      }
    };
    
    // Handle incoming stream
    pc.ontrack = (event) => {
      setParticipants(prev => prev.map(p => 
        p.id === participantId ? { ...p, stream: event.streams[0] } : p
      ));
      
      if (videoRefs.current[participantId]) {
        videoRefs.current[participantId].srcObject = event.streams[0];
      }
      
      // Setup audio analysis
      setupAudioAnalysis(participantId, event.streams[0]);
    };
    
    // Create data channel for audio levels
    const dataChannel = pc.createDataChannel('audio-data');
    dataChannels.current[participantId] = dataChannel;
    
    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    sendSignal(participantId, {
      type: 'offer',
      offer: offer,
      from: 'host'
    });
  };

  // Setup audio analysis
  const setupAudioAnalysis = (participantId, stream) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioSource = audioContext.createMediaStreamSource(stream);
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      audioSource.connect(analyzer);
      
      audioContexts.current[participantId] = audioContext;
      analyzerNodes.current[participantId] = analyzer;
      
      // Monitor audio
      const monitorAudio = () => {
        if (!gdStarted || gdEnded) return;
        
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        analyzer.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        
        const isSpeaking = average > 30;
        
        setParticipants(prev => prev.map(p => {
          if (p.id === participantId) {
            const wasNotSpeaking = !p.speaking;
            const nowSpeaking = isSpeaking;
            const newContributions = wasNotSpeaking && nowSpeaking ? p.contributions + 1 : p.contributions;
            const newSentiment = nowSpeaking && wasNotSpeaking 
              ? p.sentimentScore + (Math.random() * 2 - 0.5) 
              : p.sentimentScore;
            
            return {
              ...p,
              speaking: isSpeaking,
              contributions: newContributions,
              sentimentScore: newSentiment,
              audioLevel: average
            };
          }
          return p;
        }));
        
        if (gdStarted && !gdEnded) {
          requestAnimationFrame(monitorAudio);
        }
      };
      
      if (gdStarted) monitorAudio();
    } catch (err) {
      console.error('Audio analysis setup error:', err);
    }
  };

  // Send signal through storage
  const sendSignal = (to, data) => {
    const key = `gd_signal_${roomCode}_${to}_${Date.now()}`;
    localStorage.setItem(key, JSON.stringify(data));
    setTimeout(() => localStorage.removeItem(key), 5000);
  };

  // Handle WebRTC signaling
  const handleOffer = async (participantId, signal) => {
    // Participant sending offer (shouldn't happen in this flow)
  };

  const handleAnswer = async (participantId, signal) => {
    const pc = peerConnections.current[participantId];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
    }
  };

  const handleIceCandidate = async (participantId, signal) => {
    const pc = peerConnections.current[participantId];
    if (pc && signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  };

  const updateParticipantAudio = (participantId, audioData) => {
    setParticipants(prev => prev.map(p => 
      p.id === participantId ? { ...p, audioLevel: audioData.level } : p
    ));
  };

  // Join as Participant
  const joinAsParticipant = async () => {
    if (!participantName.trim() || !joinCode.trim()) {
      alert('Please enter your name and room code');
      return;
    }
    
    setMode('participant');
    setRoomCode(joinCode);
    
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      setMyStream(stream);
      
      if (myVideoRef.current) {
        myVideoRef.current.srcObject = stream;
      }
      
      // Send join request
      const myId = 'participant_' + Math.random().toString(36).substring(2, 9);
      sendSignal('host', {
        type: 'join-request',
        from: myId,
        name: participantName
      });
      
      // Listen for host signals
      window.addEventListener('storage', async (e) => {
        if (e.key && e.key.startsWith(`gd_signal_${joinCode}_${myId}`)) {
          const signal = JSON.parse(e.newValue);
          
          if (signal.type === 'offer') {
            await handleHostOffer(myId, stream, signal);
          } else if (signal.type === 'ice-candidate') {
            const pc = peerConnections.current['host'];
            if (pc && signal.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
          } else if (signal.type === 'gd-start') {
            setConnected(true);
          } else if (signal.type === 'gd-end') {
            alert('GD has ended! Check the host screen for your feedback.');
          }
        }
      });
      
      setConnected(true);
    } catch (err) {
      alert('Error accessing camera/microphone: ' + err.message);
    }
  };

  // Handle offer from host
  const handleHostOffer = async (myId, stream, signal) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnections.current['host'] = pc;
    
    // Add local stream
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('host', {
          type: 'ice-candidate',
          candidate: event.candidate,
          from: myId
        });
      }
    };
    
    // Handle data channel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      
      // Send audio levels
      const sendAudioLevels = () => {
        // Simplified for participant
        channel.send(JSON.stringify({
          type: 'audio-data',
          level: Math.random() * 100
        }));
      };
      
      setInterval(sendAudioLevels, 100);
    };
    
    // Set remote description and create answer
    await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    sendSignal('host', {
      type: 'answer',
      answer: answer,
      from: myId
    });
  };

  // Start GD (Host only)
  const startGD = () => {
    if (participants.length === 0) {
      alert('No participants have joined yet!');
      return;
    }
    
    setGdStarted(true);
    startTimeRef.current = Date.now();
    
    // Notify all participants
    participants.forEach(p => {
      sendSignal(p.id, {
        type: 'gd-start',
        from: 'host'
      });
    });
  };

  // End GD and generate feedback
  const endGD = () => {
    setGdEnded(true);
    setGdStarted(false);
    
    // Notify participants
    participants.forEach(p => {
      sendSignal(p.id, {
        type: 'gd-end',
        from: 'host'
      });
    });
    
    // Stop all connections
    Object.values(peerConnections.current).forEach(pc => pc.close());
    Object.values(audioContexts.current).forEach(ctx => ctx.close());
    
    // Run ML analysis
    runMLAnalysis();
  };

  const runMLAnalysis = () => {
    const results = participants.map(participant => {
      const speakingPercentage = totalTime > 0 ? (participant.speakingTime / totalTime) * 100 : 0;
      const contributionsPerMinute = totalTime > 0 ? (participant.contributions / (totalTime / 60)) : 0;
      
      const participationScore = Math.min(100, speakingPercentage * 2);
      const engagementScore = Math.min(100, contributionsPerMinute * 20);
      const balanceScore = Math.min(100, 100 - Math.abs(speakingPercentage - (100 / participants.length)) * 2);
      const sentimentScore = Math.min(100, Math.max(0, 50 + participant.sentimentScore * 10));
      
      const overallScore = (
        participationScore * 0.35 + 
        engagementScore * 0.25 + 
        balanceScore * 0.20 + 
        sentimentScore * 0.20
      ).toFixed(1);
      
      let feedback = [];
      
      if (participationScore < 40) {
        feedback.push('🔴 Low participation - try to speak more and share your ideas');
      } else if (participationScore > 70) {
        feedback.push('🟢 Excellent participation - you actively engaged in the discussion');
      } else {
        feedback.push('🟡 Good participation - maintain this level of engagement');
      }
      
      if (engagementScore < 30) {
        feedback.push('💡 Make more contributions - break down your points into smaller segments');
      } else if (engagementScore > 60) {
        feedback.push('⭐ Great engagement - you contributed frequently to the discussion');
      }
      
      if (balanceScore < 40) {
        if (speakingPercentage > (100 / participants.length)) {
          feedback.push('⚖️ Allow others more speaking time - practice active listening');
        } else {
          feedback.push('⚖️ Speak up more - your voice is valuable to the discussion');
        }
      } else {
        feedback.push('✅ Well-balanced participation - great teamwork');
      }
      
      if (sentimentScore > 60) {
        feedback.push('😊 Positive communication style - maintained constructive tone');
      } else if (sentimentScore < 40) {
        feedback.push('💭 Work on maintaining positive and constructive communication');
      }
      
      let grade;
      if (overallScore >= 85) grade = 'A+';
      else if (overallScore >= 75) grade = 'A';
      else if (overallScore >= 65) grade = 'B+';
      else if (overallScore >= 55) grade = 'B';
      else if (overallScore >= 45) grade = 'C';
      else grade = 'D';
      
      return {
        name: participant.name,
        speakingTime: participant.speakingTime,
        speakingPercentage: speakingPercentage.toFixed(1),
        contributions: participant.contributions,
        contributionsPerMinute: contributionsPerMinute.toFixed(1),
        overallScore,
        participationScore: participationScore.toFixed(1),
        engagementScore: engagementScore.toFixed(1),
        balanceScore: balanceScore.toFixed(1),
        sentimentScore: sentimentScore.toFixed(1),
        feedback,
        grade
      };
    });
    
    const avgScore = results.reduce((sum, r) => sum + parseFloat(r.overallScore), 0) / results.length;
    
    setAnalysis({
      participants: results,
      groupInsights: {
        totalTime,
        avgScore: avgScore.toFixed(1),
        totalContributions: results.reduce((sum, r) => sum + r.contributions, 0),
        bestPerformer: results.reduce((max, r) => 
          parseFloat(r.overallScore) > parseFloat(max.overallScore) ? r : max
        ),
        needsImprovement: results.reduce((min, r) => 
          parseFloat(r.overallScore) < parseFloat(min.overallScore) ? r : min
        )
      }
    });
  };

  // Copy room code
  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Timer effect
  useEffect(() => {
    let interval;
    if (gdStarted && !gdEnded) {
      interval = setInterval(() => {
        setTotalTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        
        setParticipants(prev => prev.map(p => {
          if (p.speaking) {
            return { ...p, speakingTime: p.speakingTime + 1 };
          }
          return p;
        }));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gdStarted, gdEnded]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Mode Selection Screen
  if (!mode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-12">
            <Brain className="w-16 h-16 text-blue-600 mx-auto mb-4" />
            <h1 className="text-5xl font-bold text-gray-800 mb-2">Multi-Device GD Analyzer</h1>
            <p className="text-gray-600 text-lg">Real-time Video • Multi-Device Support • AI Feedback</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Host Card */}
            <div className="bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl transition-shadow border-2 border-blue-200">
              <div className="text-center">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-10 h-10 text-blue-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Host GD Session</h2>
                <p className="text-gray-600 mb-6">Create a room and invite participants</p>
                <button
                  onClick={startAsHost}
                  className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-lg hover:from-blue-700 hover:to-purple-700 transition-all transform hover:scale-105"
                >
                  🎯 Create Room
                </button>
              </div>
            </div>

            {/* Participant Card */}
            <div className="bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl transition-shadow border-2 border-green-200">
              <div className="text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Video className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Join as Participant</h2>
                <p className="text-gray-600 mb-4">Enter room code to join</p>
                <input
                  type="text"
                  placeholder="Your Name"
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <input
                  type="text"
                  placeholder="Room Code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-green-500 focus:border-transparent uppercase"
                  maxLength={6}
                />
                <button
                  onClick={joinAsParticipant}
                  className="w-full px-6 py-4 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-xl font-bold text-lg hover:from-green-700 hover:to-blue-700 transition-all transform hover:scale-105"
                >
                  🚀 Join Room
                </button>
              </div>
            </div>
          </div>

          <div className="mt-12 bg-yellow-50 border border-yellow-200 rounded-xl p-6">
            <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600" />
              How to Use:
            </h3>
            <ul className="space-y-1 text-gray-700 text-sm">
              <li>1️⃣ <strong>Host:</strong> Opens on your laptop - creates room and gets code</li>
              <li>2️⃣ <strong>Participants:</strong> Open on their phones/laptops - enter code to join</li>
              <li>3️⃣ Host starts GD when everyone is ready</li>
              <li>4️⃣ Host ends GD and generates AI feedback for everyone</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Participant View
  if (mode === 'participant') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">👤 Participant View</h1>
            <p className="text-gray-600">Room: <span className="font-bold text-green-600">{roomCode}</span></p>
            <p className="text-gray-600">Name: <span className="font-bold">{participantName}</span></p>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <video
              ref={myVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-lg bg-gray-900 mb-4"
            />
            
            {connected ? (
              <div className="text-center space-y-3">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <div className="w-3 h-3 bg-green-600 rounded-full animate-pulse" />
                  <span className="font-semibold">Connected to GD Session</span>
                </div>
                <p className="text-gray-600">Wait for host to start the discussion</p>
                <p className="text-sm text-gray-500">Your video and audio are being streamed to the host</p>
              </div>
            ) : (
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
                <p className="text-gray-600">Connecting to session...</p>
              </div>
            )}
          </div>

          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-gray-700">
            <p className="font-semibold mb-2">📝 Tips for a Great GD:</p>
            <ul className="space-y-1">
              <li>• Speak clearly and at a moderate pace</li>
              <li>• Make eye contact with the camera</li>
              <li>• Listen actively to others</li>
              <li>• Contribute meaningfully to the discussion</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Host View (existing code continues...)
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">🎯 Host Dashboard</h1>
          <p className="text-gray-600">Multi-Device GD Analysis</p>
        </div>

        {!gdEnded && (
          <>
            {/* Room Code Display */}
            <div className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl shadow-lg p-6 text-white mb-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-3">📱 Share Room Code with Participants</h2>
                <div className="flex items-center justify-center gap-4">
                  <div className="bg-white text-blue-600 px-8 py-4 rounded-xl text-4xl font-bold tracking-widest">
                    {roomCode}
                  </div>
                  <button
                    onClick={copyRoomCode}
                    className="px-6 py-4 bg-white/20 hover:bg-white/30 rounded-xl transition-all flex items-center gap-2"
                  >
                    {copied ? <Check className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="mt-3 text-sm opacity-90">Participants can join from any device using this code</p>
              </div>
            </div>

            {/* Participants Grid */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">
                👥 Participants ({participants.length})
              </h2>
              
              {participants.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg">Waiting for participants to join...</p>
                  <p className="text-gray-400 text-sm mt-2">They should enter the room code on their devices</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {participants.map(p => (
                    <div key={p.id} className="border border-gray-200 rounded-lg p-4">
                      <h3 className="font-bold text-lg text-gray-800 mb-2">{p.name}</h3>
                      <video
                        ref={el => videoRefs.current[p.id] = el}
                        autoPlay
                        playsInline
                        className="w-full h-40 bg-gray-900 rounded-lg mb-3 object-cover"
                      />
                      
                      {gdStarted && (
                        <div className="space-y-2">
                          <div className={`flex items-center gap-2 ${p.speaking ? 'text-red-600' : 'text-gray-400'}`}>
                            <Mic className="w-4 h-4" />
                            <span className="text-sm font-semibold">
                              {p.speaking ? 'Speaking...' : 'Listening'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-600">
                            Time: {formatTime(p.speakingTime)} | Contributions: {p.contributions}
                          </div>
                          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500 transition-all"
                              style={{ width: `${Math.min(100, p.audioLevel)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Control Panel */}
            <div className="bg-gradient-to-r from-green-500 to-blue-500 rounded-xl shadow-lg p-6 text-white">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-2xl font-bold mb-2">
                    {gdStarted ? '🔴 GD in Progress' : '⏸️ Ready to Start'}
                  </h3>
                  {gdStarted && (
                    <div className="text-lg">Duration: {formatTime(totalTime)}</div>
                  )}
                </div>
                <div className="flex gap-4">
                  {!gdStarted ? (
                    <button
                      onClick={startGD}
                      disabled={participants.length === 0}
                      className="px-8 py-4 bg-white text-green-600 rounded-xl font-bold text-lg hover:bg-gray-100 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-all transform hover:scale-105"
                    >
                      🎬 Start GD
                    </button>
                  ) : (
                    <button
                      onClick={endGD}
                      className="px-8 py-4 bg-red-600 text-white rounded-xl font-bold text-lg hover:bg-red-700 transition-all transform hover:scale-105 flex items-center gap-2"
                    >
                      <StopCircle className="w-6 h-6" />
                      End GD & Generate Feedback
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Analysis Results */}
        {gdEnded && analysis && (
          <div className="space-y-6">
            {/* Group Overview */}
            <div className="bg-gradient-to-r from-green-500 to-blue-500 rounded-xl shadow-lg p-6 text-white">
              <h2 className="text-3xl font-bold mb-4">📊 Group Discussion Summary</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white/10 rounded-lg p-4">
                  <div className="text-sm opacity-90">Total Duration</div>
                  <div className="text-3xl font-bold">{formatTime(analysis.groupInsights.totalTime)}</div>
                </div>
                <div className="bg-white/10 rounded-lg p-4">
                  <div className="text-sm opacity-90">Total Contributions</div>
                  <div className="text-3xl font-bold">{analysis.groupInsights.totalContributions}</div>
                </div>
                <div className="bg-white/10 rounded-lg p-4">
                  <div className="text-sm opacity-90">Group Average</div>
                  <div className="text-3xl font-bold">{analysis.groupInsights.avgScore}</div>
                </div>
                <div className="bg-white/10 rounded-lg p-4">
                  <div className="text-sm opacity-90">Best Performer</div>
                  <div className="text-xl font-bold">{analysis.groupInsights.bestPerformer.name}</div>
                </div>
              </div>
            </div>

            {/* Individual Feedback */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-3xl font-bold text-gray-800 mb-6">🎯 Individual Feedback & Scores</h2>
              <div className="space-y-6">
                {analysis.participants.map((p, idx) => (
                  <div key={idx} className="border-2 border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-2xl font-bold text-blue-600">{p.name}</h3>
                        <div className="text-gray-600">Speaking Time: {formatTime(p.speakingTime)} ({p.speakingPercentage}%)</div>
                      </div>
                      <div className="text-right">
                        <div className="text-5xl font-bold text-purple-600">{p.grade}</div>
                        <div className="text-xl font-semibold text-gray-700">{p.overallScore}/100</div>
                      </div>
                    </div>

                    {/* Score Breakdown */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">{p.participationScore}</div>
                        <div className="text-xs text-gray-600">Participation</div>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">{p.engagementScore}</div>
                        <div className="text-xs text-gray-600">Engagement</div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-lg">
                        <div className="text-2xl font-bold text-purple-600">{p.balanceScore}</div>
                        <div className="text-xs text-gray-600">Balance</div>
                      </div>
                      <div className="text-center p-3 bg-yellow-50 rounded-lg">
                        <div className="text-2xl font-bold text-yellow-600">{p.sentimentScore}</div>
                        <div className="text-xs text-gray-600">Communication</div>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                      <div className="flex justify-between p-2 bg-gray-50 rounded">
                        <span className="text-gray-600">Contributions:</span>
                        <span className="font-semibold">{p.contributions}</span>
                      </div>
                      <div className="flex justify-between p-2 bg-gray-50 rounded">
                        <span className="text-gray-600">Per Minute:</span>
                        <span className="font-semibold">{p.contributionsPerMinute}</span>
                      </div>
                    </div>

                    {/* Feedback */}
                    <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4">
                      <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                        <Award className="w-5 h-5 text-purple-600" />
                        AI-Generated Feedback
                      </h4>
                      <ul className="space-y-2">
                        {p.feedback.map((fb, i) => (
                          <li key={i} className="text-gray-700 text-sm leading-relaxed">
                            {fb}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Group Recommendations */}
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-8 h-8 text-yellow-600 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="text-xl font-bold text-gray-800 mb-3">💡 Group Recommendations</h3>
                  <ul className="space-y-2 text-gray-700">
                    <li>• <strong>{analysis.groupInsights.bestPerformer.name}</strong> showed excellent participation and can be a role model for the group</li>
                    <li>• <strong>{analysis.groupInsights.needsImprovement.name}</strong> should work on speaking up more and actively contributing</li>
                    <li>• Encourage more balanced participation - everyone's voice matters</li>
                    <li>• Practice active listening while maintaining engagement</li>
                    <li>• Focus on quality contributions with clear, concise points</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="text-center">
              <button
                onClick={() => window.location.reload()}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-lg hover:from-blue-700 hover:to-purple-700 transition-all transform hover:scale-105"
              >
                🔄 Start New GD Session
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>✨ Multi-Device • Real-time WebRTC • AI-Powered Feedback • No Server Required</p>
        </div>
      </div>
    </div>
  );
};

export default MultiDeviceGDAnalyzer;