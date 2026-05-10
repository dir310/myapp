// ── ZIPPY Runner — Endless Traffic Game ──

let canvas, ctx;
let gameLoopId;
let gameRunning = false;
let score = 0;
let bestScore = parseInt(localStorage.getItem('zippy_runner_best') || '0');
let speed = 4;

let car = { width: 40, height: 70, lane: 1 }; // lane 0, 1, 2
let obstacles = [];
let laneWidth = 100;
let frames = 0;

const $ = (id) => document.getElementById(id);

function initGame() {
  canvas = $('runnerCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  
  laneWidth = canvas.width / 3;
  
  // Set touch listener for lanes
  canvas.addEventListener('touchstart', handleTouch, {passive: false});
  canvas.addEventListener('mousedown', handleClick);
}

function handleTouch(e) {
  e.preventDefault();
  if(!gameRunning) return;
  const rect = canvas.getBoundingClientRect();
  const touchX = e.touches[0].clientX - rect.left;
  moveCar(touchX);
}

function handleClick(e) {
  if(!gameRunning) return;
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  moveCar(clickX);
}

function moveCar(x) {
  // Map x coordinate to lane width, taking CSS scaling into account
  const scaleX = canvas.width / canvas.getBoundingClientRect().width;
  const mappedX = x * scaleX;

  if (mappedX < laneWidth && car.lane > 0) car.lane--;
  else if (mappedX > laneWidth * 2 && car.lane < 2) car.lane++;
  else if (mappedX >= laneWidth && mappedX <= laneWidth * 2) {
    if (car.lane === 0) car.lane = 1;
    else if (car.lane === 2) car.lane = 1;
  }
}

function openRunner() {
  $('runnerOverlay').style.display = 'flex';
  $('runnerStartScreen').style.display = 'flex';
  $('runnerGameOver').style.display = 'none';
  $('runnerBest').textContent = bestScore;
  $('runnerScore').textContent = '0';
  if (!canvas) initGame();
  drawIdle();
}

function closeRunner() {
  $('runnerOverlay').style.display = 'none';
  gameRunning = false;
  cancelAnimationFrame(gameLoopId);
}

function startRunner() {
  $('runnerStartScreen').style.display = 'none';
  $('runnerGameOver').style.display = 'none';
  score = 0;
  speed = 4;
  frames = 0;
  car.lane = 1;
  obstacles = [];
  gameRunning = true;
  $('runnerScore').textContent = score;
  gameLoop();
}

function drawIdle() {
    if(!ctx) return;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawRoad();
    drawCar(car.lane, canvas.height - 90);
}

function drawRoad() {
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.setLineDash([20, 20]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(laneWidth, 0); ctx.lineTo(laneWidth, canvas.height);
  ctx.moveTo(laneWidth*2, 0); ctx.lineTo(laneWidth*2, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCar(lane, yPos) {
  const xPos = (lane * laneWidth) + (laneWidth / 2) - (car.width / 2);
  
  ctx.fillStyle = '#FF6B00';
  ctx.beginPath();
  ctx.roundRect(xPos, yPos, car.width, car.height, 8);
  ctx.fill();

  ctx.fillStyle = '#222';
  ctx.fillRect(xPos + 5, yPos + 15, car.width - 10, 15);
  ctx.fillRect(xPos + 5, yPos + 50, car.width - 10, 10);
  
  ctx.fillStyle = '#fffae6';
  ctx.fillRect(xPos + 5, yPos - 3, 8, 5);
  ctx.fillRect(xPos + car.width - 13, yPos - 3, 8, 5);
}

function drawObstacle(obs) {
  const xPos = (obs.lane * laneWidth) + (laneWidth / 2) - (obs.width / 2);
  
  if (obs.type === 'cone') {
    ctx.fillStyle = '#FF3B30';
    ctx.beginPath();
    ctx.moveTo(xPos + obs.width/2, obs.y);
    ctx.lineTo(xPos + obs.width, obs.y + obs.height);
    ctx.lineTo(xPos, obs.y + obs.height);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(xPos + 5, obs.y + 10, obs.width - 10, 6);
  } else {
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.roundRect(xPos, obs.y, obs.width, obs.height, 8);
    ctx.fill();
    ctx.fillStyle = '#FF3B30';
    ctx.fillRect(xPos + 5, obs.y - 3, 8, 5);
    ctx.fillRect(xPos + obs.width - 13, obs.y - 3, 8, 5);
  }
}

function gameLoop() {
  if (!gameRunning) return;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineDashOffset = -frames * speed;
  drawRoad();

  const carY = canvas.height - 90;
  drawCar(car.lane, carY);

  if (frames % Math.max(30, 80 - Math.floor(speed * 3)) === 0) {
    const isCone = Math.random() > 0.5;
    obstacles.push({
      lane: Math.floor(Math.random() * 3),
      y: -80,
      width: isCone ? 24 : 40,
      height: isCone ? 70 : 70, // Keep height same to avoid buggy hitbox
      type: isCone ? 'cone' : 'car'
    });
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    let obs = obstacles[i];
    obs.y += speed;
    drawObstacle(obs);

    const obsX = (obs.lane * laneWidth) + (laneWidth / 2) - (obs.width / 2);
    const carX = (car.lane * laneWidth) + (laneWidth / 2) - (car.width / 2);
    
    // Check hit
    if (
      carX < obsX + obs.width &&
      carX + car.width > obsX &&
      carY < obs.y + obs.height &&
      carY + car.height > obs.y
    ) {
      gameOver();
      return;
    }

    if (obs.y > canvas.height) {
      obstacles.splice(i, 1);
      score += 10;
      $('runnerScore').textContent = score;
      if (score % 100 === 0) speed += 0.5;
    }
  }

  frames++;
  gameLoopId = requestAnimationFrame(gameLoop);
}

function gameOver() {
  gameRunning = false;
  $('runnerGameOver').style.display = 'flex';
  $('runnerFinalScore').textContent = score;
  
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('zippy_runner_best', bestScore);
    $('runnerBest').textContent = bestScore;
  }
}

window.openRunner = openRunner;
window.closeRunner = closeRunner;
window.startRunner = startRunner;
