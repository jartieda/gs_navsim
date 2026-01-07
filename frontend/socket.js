// socket.js
// Handles socket communication for robot commands

export function setupSocket(robot, scene, camera, renderer, cameraController, onMovementCallback = null) {
  const socket = new WebSocket('ws://localhost:8081');
  
  socket.onopen = () => {
    console.log('Connected to robot command server');
    // Identify as frontend client
    socket.send(JSON.stringify({ type: 'identify', client: 'frontend' }));
  };
  
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('Frontend received message:', msg);
      
      if (msg.type === 'movement_command') {
        console.log('Processing movement command:', msg.command);
        
        if (msg.command === 'forward') {
          robot.moveForward();
        } else if (msg.command === 'backward') {
          robot.moveBackward();
        } else if (msg.command === 'turn_left') {
          robot.turnLeft(msg.value || Math.PI / 8);
        } else if (msg.command === 'turn_right') {
          robot.turnRight(msg.value || Math.PI / 8);
        } else if (msg.command === 'turn') {
          if (msg.value > 0) {
            robot.turnLeft(Math.abs(msg.value));
          } else {
            robot.turnRight(Math.abs(msg.value));
          }
        } else if (msg.command === 'set_velocity') {
          // Handle velocity commands [v, w] (linear, angular)
          const v = msg.value[0] || 0;
          const w = msg.value[1] || 0;
          
          if (Math.abs(v) > 0.01) {
            if (v > 0) {
              robot.moveForward(Math.abs(v));
            } else {
              robot.moveBackward(Math.abs(v));
            }
          }
          
          if (Math.abs(w) > 0.01) {
            if (w > 0) {
              robot.turnLeft(Math.abs(w));
            } else {
              robot.turnRight(Math.abs(w));
            }
          }
        }
        
        // Camera position will be updated automatically through the CameraController
        if (cameraController) {
          cameraController.update();
        }
        
        // Render scene
        renderer.render(scene, camera);
        
        // Call movement callback if provided
        if (onMovementCallback) {
          onMovementCallback();
        }
        
        // Send back rendered image automatically
        setTimeout(() => {
          captureAndSendImage(socket, renderer);
        }, 100);
        
      } else if (msg.type === 'capture_image') {
        // Manual image capture request
        console.log('Frontend: Received capture_image request');
        captureAndSendImage(socket, renderer);
      }
      
    } catch (error) {
      console.error('Error processing robot command:', error);
    }
  };
  
  socket.onclose = () => {
    console.log('Disconnected from robot command server');
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  return socket;
}

function captureAndSendImage(socket, renderer) {
  console.log('Frontend: Capturing and sending image...');
  const image = renderer.domElement.toDataURL('image/png');
  const timestamp = new Date().toISOString();
  
  socket.send(JSON.stringify({
    type: 'rendered_image',
    data: image,
    timestamp: timestamp
  }));
  
  console.log('Frontend: Sent rendered image, size:', image.length);
}
