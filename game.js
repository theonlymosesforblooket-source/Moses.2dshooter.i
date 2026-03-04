// game.js

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const ui = document.getElementById('ui-overlay');
const hud = document.getElementById('hud');

const debugMenu = document.getElementById('debug-menu');
const dbgSpeed   = document.getElementById('dbg-speed');
const dbgReload  = document.getElementById('dbg-reload');
const dbgBullets = document.getElementById('dbg-bullets');
const dbgHealth  = document.getElementById('dbg-health');
const dbgSpread  = document.getElementById('dbg-spread');

// ---------- WORLD / CAMERA ----------
const WORLD_SIZE = 8000;
const CENTER = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
const MINIMAP_SIZE = 220;
const MINIMAP_PADDING = 18;

let camX = 0, camY = 0;

// ---------- PLAYER / TRAITS / CLASSES ----------
let playerClass = null;

const TRAITS = {
    power: 0,      // +bullets
    agility: 0,    // faster reload
    mobility: 0,   // move speed
    control: 0,    // tighter spread
    durability: 0  // +max hits
};

const CLASSES = {
    shotgun: {
        name: "Shotgunner",
        bulletCount: 6,
        shootCooldown: 900,
        speed: 8,
        bulletSize: 4,
        spread: 0.35,
        maxHitsMod: 1
    },
    sniper: {
        name: "Sniper",
        bulletCount: 1,
        shootCooldown: 2000,
        speed: 9,
        bulletSize: 7,
        spread: 0.02,
        maxHitsMod: -1
    },
    machine: {
        name: "Machine Gunner",
        bulletCount: 1,
        shootCooldown: 200,
        speed: 9,
        bulletSize: 2,
        spread: 0.12,
        maxHitsMod: 0
    }
};

let player = {
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    angle: 0,
    baseSpeed: 10,
    size: 10,
    hits: 1,
    maxHits: 1
};

// ---------- DEBUG STATS (ABSOLUTE VALUES) ----------
let debugMode = false;

const DEBUG_VALUES = {
    moveSpeed: null,   // null = use normal calc
    reloadMs: null,
    bullets: null,
    maxHits: null,
    spread: null
};

// ---------- LEVELING ----------
let xp = 0;
let level = 1;
let xpToNext = 5; // 5 → 7 → 10 → 14 → ...

// ---------- GAME STATE ----------
let bullets = [];
let enemies = [];
let zombiesKilled = 0;

let lastShotTime = 0;
let lastHitTime = 0;
const HIT_COOLDOWN = 500;

let gameActive = true;
let isClassMenu = false;

let zombieSpeedBonus = 0; // increases every level after 10

// ---------- CAMERA + RESIZE ----------
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.imageSmoothingEnabled = false;

    camX = player.x - canvas.width / 2;
    camY = player.y - canvas.height / 2;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ---------- COORD HELPERS ----------
function worldToScreen(wx, wy) {
    return {
        sx: Math.round(wx - camX),
        sy: Math.round(wy - camY)
    };
}

function clampWorld() {
    player.x = Math.max(0, Math.min(WORLD_SIZE, player.x));
    player.y = Math.max(0, Math.min(WORLD_SIZE, player.y));
    camX = Math.max(0, Math.min(WORLD_SIZE - canvas.width, player.x - canvas.width / 2));
    camY = Math.max(0, Math.min(WORLD_SIZE - canvas.height, player.y - canvas.height / 2));
}

// ---------- INPUT ----------
let mouse = { x: 0, y: 0 };
let keys = {};

window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (e.code === 'Space') e.preventDefault();

    // secret combo: 5 + i + r → debug stats panel
    if (keys['5'] && keys['i'] && keys['r']) {
        if (debugMenu.style.display === 'none') {
            openDebugMenu();
        } else {
            closeDebugMenu();
        }
    }

    // U key → open trait upgrade panel any time while playing
    if (k === 'u' && gameActive) {
        openTraitMenu();
    }
});

window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    keys[k] = false;
});

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------- MINIMAP ----------
function drawMinimap() {
    const mapSize = MINIMAP_SIZE;
    const scale = mapSize / WORLD_SIZE;
    const x = MINIMAP_PADDING;
    const y = canvas.height - mapSize - MINIMAP_PADDING;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(x, y, mapSize, mapSize);
    ctx.strokeStyle = "#00ccff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, mapSize, mapSize);

    // center marker
    const cx = x + CENTER.x * scale;
    const cy = y + CENTER.y * scale;
    ctx.fillStyle = "#333";
    ctx.fillRect(cx - 2, cy - 2, 4, 4);

    // enemies
    ctx.fillStyle = "rgba(255,60,60,0.9)";
    for (let e of enemies) {
        const ex = x + e.x * scale;
        const ey = y + e.y * scale;
        ctx.fillRect(ex, ey, 2, 2);
    }

    // player
    ctx.fillStyle = "lime";
    const px = x + player.x * scale;
    const py = y + player.y * scale;
    ctx.fillRect(px - 3, py - 3, 6, 6);

    ctx.restore();
}

// ---------- DANGER LEVEL ----------
function computeDangerLevel() {
    const dist = Math.hypot(player.x - CENTER.x, player.y - CENTER.y);
    const maxDist = WORLD_SIZE / 2;
    let danger = 1 - (dist / maxDist);
    if (danger < 0) danger = 0;
    if (danger > 1) danger = 1;
    return danger;
}

// ---------- TRAITS (UNLIMITED UPGRADES) ----------
function applyTrait(trait) {
    TRAITS[trait]++;

    if (trait === 'durability') {
        updateMaxHits();
        player.hits = player.maxHits;
    }

    updateTraitButtons();
}

function updateTraitButtons() {
    document.querySelector('[data-trait="power"]'    ).textContent = `POWER (+${TRAITS.power} bullets)`;
    document.querySelector('[data-trait="agility"]'  ).textContent = `AGILITY (x${(0.9 ** TRAITS.agility).toFixed(2)} cooldown)`;
    document.querySelector('[data-trait="mobility"]' ).textContent = `MOBILITY (+${(0.6 * TRAITS.mobility).toFixed(1)} speed)`;
    document.querySelector('[data-trait="control"]'  ).textContent = `CONTROL (x${(0.9 ** TRAITS.control).toFixed(2)} spread)`;
    document.querySelector('[data-trait="durability"]').textContent = `DURABILITY (+${TRAITS.durability} hits)`;
}

// ---------- EFFECTIVE STATS (WITH DEBUG OVERRIDES) ----------
function getEffectiveBulletCount() {
    const cls = playerClass ? CLASSES[playerClass] : null;
    let base = cls ? cls.bulletCount : 1;
    base += TRAITS.power;

    if (debugMode && DEBUG_VALUES.bullets != null) {
        return Math.max(1, DEBUG_VALUES.bullets);
    }
    return Math.max(1, base);
}

function getEffectiveShootCooldown() {
    const cls = playerClass ? CLASSES[playerClass] : null;
    let base = cls ? cls.shootCooldown : 1000;
    const factor = Math.pow(0.9, TRAITS.agility);
    let cd = Math.max(80, base * factor);

    if (debugMode && DEBUG_VALUES.reloadMs != null) {
        return Math.max(10, DEBUG_VALUES.reloadMs);
    }
    return cd;
}

function getEffectiveSpeed() {
    const cls = playerClass ? CLASSES[playerClass] : null;
    let base = cls ? cls.speed : player.baseSpeed;
    base += TRAITS.mobility * 0.6;

    if (debugMode && DEBUG_VALUES.moveSpeed != null) {
        return DEBUG_VALUES.moveSpeed;
    }
    return base;
}

function getEffectiveSpread() {
    const cls = playerClass ? CLASSES[playerClass] : null;
    let base = cls ? cls.spread : 0.18;
    const factor = Math.pow(0.9, TRAITS.control);
    let s = base * factor;

    if (debugMode && DEBUG_VALUES.spread != null) {
        return Math.max(0, DEBUG_VALUES.spread);
    }
    return s;
}

function getEffectiveBulletSize() {
    const cls = playerClass ? CLASSES[playerClass] : null;
    return cls ? cls.bulletSize : 3;
}

function updateMaxHits() {
    const cls = playerClass ? CLASSES[playerClass] : null;
    let base = 1 + (cls ? cls.maxHitsMod : 0) + TRAITS.durability;

    if (debugMode && DEBUG_VALUES.maxHits != null) {
        base = DEBUG_VALUES.maxHits;
    }

    if (base < 1) base = 1;
    player.maxHits = base;
    if (player.hits > player.maxHits) player.hits = player.maxHits;
}

// ---------- LEVELING ----------
function addXP(amount) {
    xp += amount;

    while (xp >= xpToNext) {
        xp -= xpToNext;
        level++;

        xpToNext = Math.floor(xpToNext * 1.35);

        if (level > 10) {
            zombieSpeedBonus += 0.05;
        }

        if (level === 10 && !playerClass) {
            openClassMenu();
            return;
        }

        if (level < 10) {
            openTraitMenu();
            return;
        }
    }
}

// ---------- SPAWNING ----------
let spawnTimer = 0;
let spawnInterval = 1200; // ms
const SPAWN_MIN_DIST = 500;
const SPAWN_MAX_DIST = 900;

function spawnZombieAroundPlayer() {
    let angle = Math.random() * Math.PI * 2;
    let dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);

    let x = player.x + Math.cos(angle) * dist;
    let y = player.y + Math.sin(angle) * dist;

    x = Math.max(0, Math.min(WORLD_SIZE, x));
    y = Math.max(0, Math.min(WORLD_SIZE, y));

    const danger = computeDangerLevel();
    const speed = 0.7 + (level * 0.05) + zombieSpeedBonus + danger * 0.3;

    enemies.push({
        x,
        y,
        size: 18,
        speed
    });
}

// ---------- MENUS ----------
function openTraitMenu() {
    isClassMenu = false;
    document.getElementById('menu-title').innerText = `LEVEL ${level}`;
    document.getElementById('menu-text').innerText = 'SELECT TRAIT UPGRADE:';
    document.getElementById('trait-buttons').style.display = 'block';
    document.getElementById('class-buttons').style.display = 'none';
    ui.style.display = 'block';
    gameActive = false;
    updateTraitButtons();
}

function openClassMenu() {
    isClassMenu = true;
    document.getElementById('menu-title').innerText = 'CHOOSE YOUR CLASS';
    document.getElementById('menu-text').innerText = 'SELECT ONE (PERMANENT THIS RUN):';
    document.getElementById('trait-buttons').style.display = 'none';
    document.getElementById('class-buttons').style.display = 'block';
    ui.style.display = 'block';
    gameActive = false;
}

// ---------- DEBUG STATS MENU ----------
function openDebugMenu() {
    debugMode = true;

    dbgSpeed.value   = getEffectiveSpeed().toFixed(1);
    dbgReload.value  = getEffectiveShootCooldown().toFixed(0);
    dbgBullets.value = getEffectiveBulletCount().toFixed(0);
    dbgHealth.value  = player.maxHits.toFixed(0);
    dbgSpread.value  = getEffectiveSpread().toFixed(3);

    debugMenu.style.display = 'block';
    gameActive = false;
}

function closeDebugMenu() {
    debugMenu.style.display = 'none';
    gameActive = true;
}

document.getElementById('dbg-apply').addEventListener('click', () => {
    const speed   = Number(dbgSpeed.value);
    const reload  = Number(dbgReload.value);
    const bullets = Number(dbgBullets.value);
    const health  = Number(dbgHealth.value);
    const spread  = Number(dbgSpread.value);

    DEBUG_VALUES.moveSpeed = isNaN(speed)   ? null : speed;
    DEBUG_VALUES.reloadMs  = isNaN(reload)  ? null : reload;
    DEBUG_VALUES.bullets   = isNaN(bullets) ? null : bullets;
    DEBUG_VALUES.maxHits   = isNaN(health)  ? null : health;
    DEBUG_VALUES.spread    = isNaN(spread)  ? null : spread;

    updateMaxHits();
    player.hits = player.maxHits;

    closeDebugMenu();
});

document.getElementById('dbg-close').addEventListener('click', () => {
    closeDebugMenu();
});

// ---------- SHOOTING ----------
function shoot() {
    const now = Date.now();
    const cooldown = getEffectiveShootCooldown();
    if (now - lastShotTime < cooldown) return;
    lastShotTime = now;

    const bulletCount = getEffectiveBulletCount();
    const spread = getEffectiveSpread();
    const bulletSize = getEffectiveBulletSize();
    const speed = 22;

    const worldMouseX = mouse.x + camX;
    const worldMouseY = mouse.y + camY;

    const baseAngle = Math.atan2(
        worldMouseY - player.y,
        worldMouseX - player.x
    );

    const half = (bulletCount - 1) / 2;

    for (let i = 0; i < bulletCount; i++) {
        let angle = baseAngle;
        if (bulletCount > 1) {
            angle = baseAngle + ((i - half) / Math.max(half, 1)) * (spread / 2);
        }

        bullets.push({
            x: player.x,
            y: player.y,
            dx: Math.cos(angle) * speed,
            dy: Math.sin(angle) * speed,
            size: bulletSize
        });
    }
}

// ---------- UPDATE LOOP ----------
function update() {
    if (!gameActive) return;

    const now = Date.now();
    const deltaTime = now - (update.lastTime || now);
    update.lastTime = now;

    // movement
    let vx = 0, vy = 0;
    if (keys['w']) vy -= 1;
    if (keys['s']) vy += 1;
    if (keys['a']) vx -= 1;
    if (keys['d']) vx += 1;

    const mag = Math.hypot(vx, vy) || 1;
    const speed = getEffectiveSpeed();
    vx = (vx / mag) * speed;
    vy = (vy / mag) * speed;

    player.x += vx;
    player.y += vy;
    clampWorld();

    if (vx || vy) {
        player.angle = Math.atan2(vy, vx);
    }

    // shooting
    if (keys[' ']) shoot();

    // spawning
    spawnTimer += deltaTime;
    if (spawnTimer > spawnInterval) {
        spawnZombieAroundPlayer();
        spawnTimer = 0;
        spawnInterval = Math.max(300, 1200 - level * 20);
    }

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.dx;
        b.y += b.dy;

        if (b.x < 0 || b.x > WORLD_SIZE || b.y < 0 || b.y > WORLD_SIZE) {
            bullets.splice(i, 1);
            continue;
        }

        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (Math.hypot(b.x - e.x, b.y - e.y) < (e.size / 2 + b.size)) {
                enemies.splice(j, 1);
                bullets.splice(i, 1);
                zombiesKilled++;
                addXP(1);
                break;
            }
        }
    }
}

// ---------- ZOMBIES ----------
function updateZombies() {
    if (!gameActive) return;

    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;

        e.x += (dx / dist) * e.speed;
        e.y += (dy / dist) * e.speed;
    }
}

function pushZombiesApart() {
    if (!gameActive) return;

    for (let i = 0; i < enemies.length; i++) {
        for (let j = i + 1; j < enemies.length; j++) {
            const a = enemies[i];
            const b = enemies[j];

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minDist = (a.size / 2) + (b.size / 2);

            if (dist > 0 && dist < minDist) {
                const overlap = minDist - dist;
                const pushX = (dx / dist) * (overlap / 2);
                const pushY = (dy / dist) * (overlap / 2);

                a.x -= pushX;
                a.y -= pushY;
                b.x += pushX;
                b.y += pushY;
            }
        }
    }
}

function checkPlayerHits() {
    if (!gameActive) return;

    const now = Date.now();

    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const dist = Math.hypot(player.x - e.x, player.y - e.y);

        if (dist < (e.size / 2 + player.size)) {
            if (now - lastHitTime > HIT_COOLDOWN) {
                enemies.splice(i, 1);
                player.hits--;
                lastHitTime = now;

                if (player.hits <= 0) {
                    resetGame();
                    return;
                }
            }
        }
    }
}

// ---------- DRAW ----------
function drawPlayer() {
    const p = worldToScreen(player.x, player.y);

    ctx.save();
    ctx.translate(p.sx, p.sy);
    ctx.rotate(player.angle);

    ctx.fillStyle = "#00ccff";
    ctx.beginPath();
    ctx.moveTo(player.size, 0);
    ctx.lineTo(-player.size, -player.size / 1.5);
    ctx.lineTo(-player.size, player.size / 1.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // hits
    for (let i = 0; i < player.maxHits; i++) {
        ctx.fillStyle = i < player.hits ? "lime" : "#550000";
        ctx.fillRect(20 + i * 24, 20, 20, 20);
    }
}

function drawBullets() {
    ctx.fillStyle = "#ffff66";
    for (let b of bullets) {
        const p = worldToScreen(b.x, b.y);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, b.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawEnemies() {
    for (let e of enemies) {
        const p = worldToScreen(e.x, e.y);

        ctx.fillStyle = "#00cc00";
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, e.size / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ff0000";
        ctx.beginPath();
        ctx.arc(p.sx - 4, p.sy - 3, 2, 0, Math.PI * 2);
        ctx.arc(p.sx + 4, p.sy - 3, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawWorldBounds() {
    const tl = worldToScreen(0, 0);
    const br = worldToScreen(WORLD_SIZE, WORLD_SIZE);

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 4;
    ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
}

function drawCursor() {
    const size = 8;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = "#00ccff";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(mouse.x - size, mouse.y);
    ctx.lineTo(mouse.x + size, mouse.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mouse.x, mouse.y - size);
    ctx.lineTo(mouse.x, mouse.y + size);
    ctx.stroke();

    ctx.restore();
}

function updateHUD() {
    hud.innerHTML =
        `Level: ${level}<br>` +
        `XP: ${xp} / ${xpToNext}<br>` +
        `Kills: ${zombiesKilled}<br>` +
        `Zombies: ${enemies.length}`;
}

function drawDebug() {
    // optional: draw extra debug info here
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawWorldBounds();
    drawBullets();
    drawEnemies();
    drawPlayer();
    drawMinimap();
    drawDebug();
    updateHUD();
    drawCursor();
}

// ---------- UI HANDLERS ----------
document.getElementById('trait-buttons').addEventListener('click', e => {
    if (!e.target.classList.contains('btn')) return;
    const trait = e.target.getAttribute('data-trait');
    applyTrait(trait);
    ui.style.display = 'none';
    gameActive = true;
});

document.getElementById('class-buttons').addEventListener('click', e => {
    if (!e.target.classList.contains('btn')) return;
    const cls = e.target.getAttribute('data-class');
    playerClass = cls;
    updateMaxHits();
    player.hits = player.maxHits;

    ui.style.display = 'none';
    gameActive = true;
});

// ---------- RESET ----------
function resetGame() {
    bullets = [];
    enemies = [];
    zombiesKilled = 0;

    xp = 0;
    level = 1;
    xpToNext = 5;

    playerClass = null;
    TRAITS.power = 0;
    TRAITS.agility = 0;
    TRAITS.mobility = 0;
    TRAITS.control = 0;
    TRAITS.durability = 0;

    player.x = WORLD_SIZE / 2;
    player.y = WORLD_SIZE / 2;
    player.angle = 0;

    debugMode = false;
    DEBUG_VALUES.moveSpeed = null;
    DEBUG_VALUES.reloadMs = null;
    DEBUG_VALUES.bullets = null;
    DEBUG_VALUES.maxHits = null;
    DEBUG_VALUES.spread = null;

    updateMaxHits();
    player.hits = player.maxHits;

    zombieSpeedBonus = 0;
    spawnTimer = 0;
    spawnInterval = 1200;

    gameActive = true;
    ui.style.display = 'none';
}

// ---------- MAIN LOOP ----------
function gameLoop() {
    update();
    updateZombies();
    pushZombiesApart();
    checkPlayerHits();
    draw();
    requestAnimationFrame(gameLoop);
}

// ---------- START ----------
resetGame();
gameLoop();

