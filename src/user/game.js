/**
 * Zippy Jump Mini-Game: A simple side-scroller for wait times.
 */

let canvas, ctx;
let animationId;
let isPlaying = false;
let score = 0;
let bestScore = localStorage.getItem('zippy_jump_best') || 0;

// Game Config
const GRAVITY = 0.6;
const JUMP_FORCE = -12;
const GROUND_Y = 160;

// Player (Moto)
const player = {
    x: 50,
    y: GROUND_Y,
    vy: 0,
    width: 40,
    height: 30,
    emoji: '🏍️'
};

// Obstacles (Cones)
let obstacles = [];
let frameCount = 0;

export function initGame() {
    canvas = document.getElementById('zippyGameCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Set internal resolution
    canvas.width = 400;
    canvas.height = 200;

    document.getElementById('gameBest').textContent = bestScore;

    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) {
        startBtn.onclick = (e) => {
            e.stopPropagation();
            startGame();
        };
    }

    const closeBtn = document.getElementById('closeGameBtn');
    if (closeBtn) {
        closeBtn.onclick = () => stopGame();
    }

    // Input handlers
    canvas.onclick = (e) => {
      e.stopPropagation();
      if (isPlaying) jump();
    };
    
    // Key handler for testing
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && isPlaying) {
        e.preventDefault();
        jump();
      }
    });

    renderInitial();
}

function renderInitial() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Ground
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 20);
    ctx.lineTo(canvas.width, GROUND_Y + 20);
    ctx.stroke();

    // Player
    ctx.font = '30px serif';
    ctx.fillText(player.emoji, player.x, player.y + 15);
}

function startGame() {
    isPlaying = true;
    score = 0;
    obstacles = [];
    player.y = GROUND_Y;
    player.vy = 0;
    frameCount = 0;
    
    document.getElementById('gameOverlay').style.display = 'none';
    document.getElementById('gameScore').textContent = '0';
    
    loop();
}

export function stopGame() {
    isPlaying = false;
    cancelAnimationFrame(animationId);
    document.getElementById('zippyJumpModal').style.display = 'none';
    document.getElementById('gameOverlay').style.display = 'flex';
}

function jump() {
    if (player.y >= GROUND_Y) {
        player.vy = JUMP_FORCE;
    }
}

function loop() {
    if (!isPlaying) return;

    update();
    draw();

    animationId = requestAnimationFrame(loop);
}

function update() {
    frameCount++;
    
    // Update Player
    player.vy += GRAVITY;
    player.y += player.vy;

    if (player.y > GROUND_Y) {
        player.y = GROUND_Y;
        player.vy = 0;
    }

    // Spawn Obstacles
    if (frameCount % 90 === 0) {
        obstacles.push({
            x: canvas.width,
            y: GROUND_Y + 15,
            width: 20,
            height: 25,
            emoji: '⚠️'
        });
    }

    // Update Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.x -= 5;

        // Collision Check
        if (
            player.x < obs.x + obs.width &&
            player.x + player.width > obs.x &&
            player.y < obs.y &&
            player.y + player.height > obs.y - obs.height
        ) {
            gameOver();
        }

        if (obs.x + obs.width < 0) {
            obstacles.splice(i, 1);
            score++;
            document.getElementById('gameScore').textContent = score;
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ground Line
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 20);
    ctx.lineTo(canvas.width, GROUND_Y + 20);
    ctx.stroke();
    ctx.setLineDash([]);

    // Player
    ctx.font = '30px serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.emoji, player.x, player.y);

    // Obstacles
    ctx.font = '22px serif';
    obstacles.forEach(obs => {
        ctx.fillText(obs.emoji, obs.x, obs.y);
    });
}

function gameOver() {
    isPlaying = false;
    cancelAnimationFrame(animationId);
    
    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('zippy_jump_best', bestScore);
        document.getElementById('gameBest').textContent = bestScore;
    }

    document.getElementById('gameMsg').innerHTML = `¡CRASH! 💥<br>Score: ${score}`;
    document.getElementById('gameOverlay').style.display = 'flex';
    document.getElementById('startGameBtn').textContent = 'Reintentar';
}
