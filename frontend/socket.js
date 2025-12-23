// socket.js
// Handles socket communication for robot commands

export function setupSocket(robot, scene, camera, renderer, cameraController, onMovementCallback = null) {
  const socket = new WebSocket('ws://localhost:8081');
  
  socket.onopen = () => {
    console.log('Connected to robot command server');
  };
  
  socket.onmessage = (event) => {
    try {
      const cmd = JSON.parse(event.data);
      console.log('Received command:', cmd);
      
      if (cmd.type === 'forward') {
        // Move robot forward using RobotController method
        robot.moveForward();
      } else if (cmd.type === 'turn') {
        // Turn robot by specified value using RobotController method
        if (cmd.value > 0) {
          robot.turnLeft(Math.abs(cmd.value));
        } else {
          robot.turnRight(Math.abs(cmd.value));
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
      
      // Send back rendered image
      setTimeout(() => {
        const image = renderer.domElement.toDataURL('image/png');
        socket.send(JSON.stringify({ type: 'image', data: image }));
      }, 100); // Small delay to ensure rendering is complete
      
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
}
