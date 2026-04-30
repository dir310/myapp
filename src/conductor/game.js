// Memorama ZIPPY para el conductor

let hasFlippedCard = false;
let lockBoard = false;
let firstCard, secondCard;
let matchCount = 0;
let moves = 0;
let timeElapsed = 0;
let timerInterval = null;

const ICONS = ['🚕', '🏍️', '📦', '🍔', '🛵', '⚡', '📍', '💰']; // 8 pares = 16 cartas

export function initMemorama() {
    const grid = document.getElementById('memoGrid');
    if (!grid) return;
    
    // Reset state
    grid.innerHTML = '';
    hasFlippedCard = false;
    lockBoard = false;
    firstCard = null;
    secondCard = null;
    matchCount = 0;
    moves = 0;
    timeElapsed = 0;
    
    document.getElementById('memoMoves').textContent = moves;
    document.getElementById('memoTime').textContent = '00:00';
    document.getElementById('memoWinScreen').style.display = 'none';
    
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeElapsed++;
        const m = String(Math.floor(timeElapsed / 60)).padStart(2, '0');
        const s = String(timeElapsed % 60).padStart(2, '0');
        document.getElementById('memoTime').textContent = `${m}:${s}`;
    }, 1000);

    // Create cards
    const deck = [...ICONS, ...ICONS].sort(() => 0.5 - Math.random());
    
    deck.forEach(icon => {
        const card = document.createElement('div');
        card.classList.add('memo-card');
        card.dataset.icon = icon;
        
        card.innerHTML = `
            <div class="memo-face memo-front">?</div>
            <div class="memo-face memo-back">${icon}</div>
        `;
        
        card.addEventListener('click', flipCard);
        grid.appendChild(card);
    });
}

function flipCard() {
    if (lockBoard) return;
    if (this === firstCard) return;

    this.classList.add('flipped');

    if (!hasFlippedCard) {
        hasFlippedCard = true;
        firstCard = this;
        return;
    }

    secondCard = this;
    moves++;
    document.getElementById('memoMoves').textContent = moves;
    
    checkForMatch();
}

function checkForMatch() {
    let isMatch = firstCard.dataset.icon === secondCard.dataset.icon;

    if (isMatch) {
        disableCards();
    } else {
        unflipCards();
    }
}

function disableCards() {
    firstCard.removeEventListener('click', flipCard);
    secondCard.removeEventListener('click', flipCard);
    
    firstCard.classList.add('matched');
    secondCard.classList.add('matched');

    resetBoard();
    
    matchCount++;
    if (matchCount === ICONS.length) {
        clearInterval(timerInterval);
        setTimeout(() => {
            document.getElementById('memoWinScreen').style.display = 'block';
            document.getElementById('memoFinalMoves').textContent = moves;
            const m = String(Math.floor(timeElapsed / 60)).padStart(2, '0');
            const s = String(timeElapsed % 60).padStart(2, '0');
            document.getElementById('memoFinalTime').textContent = `${m}:${s}`;
        }, 500);
    }
}

function unflipCards() {
    lockBoard = true;

    setTimeout(() => {
        firstCard.classList.remove('flipped');
        secondCard.classList.remove('flipped');
        resetBoard();
    }, 1000);
}

function resetBoard() {
    [hasFlippedCard, lockBoard] = [false, false];
    [firstCard, secondCard] = [null, null];
}

export function showMemorama() {
    document.getElementById('memoramaOverlay').style.display = 'flex';
    initMemorama();
}

export function closeMemorama() {
    document.getElementById('memoramaOverlay').style.display = 'none';
    clearInterval(timerInterval);
}

window.showMemorama = showMemorama;
window.closeMemorama = closeMemorama;
window.initMemorama = initMemorama;
