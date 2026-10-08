/**
 * PINTA EL PISO - Territory Game Mode
 * Three.js based territory game where players paint the floor
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController } from '../animation/AnimationController.js';
import { loadClips, loadModel } from '../assets/AssetLoader.js';
import PaintHUD from './PaintHUD.js';
import { openRoom, installParty, isPartyMode } from '../party/PartyClient.js';

const PAINT_CONFIG = {
    GRID_SIZE: 60,
    WORLD_SIZE: 20,
    CAMERA_HEIGHT: 22,
    CAMERA_ANGLE: Math.PI / 4
};

const CHARACTER_MODELS = {
    edgar: { name: 'Edgar', file: 'Edgar_Model.fbx' },
    isabella: { name: 'Isabella', file: 'Isabella_Model.fbx' },
    jesus: { name: 'Jesus', file: 'Jesus_Model.fbx' },
    lia: { name: 'Lia', file: 'Lia_Model.fbx' },
    hector: { name: 'Hector', file: 'Hector.fbx' },
    katy: { name: 'Katy', file: 'Katy.fbx' },
    mariana: { name: 'Mariana', file: 'Mariana.fbx' },
    sol: { name: 'Sol', file: 'Sol.fbx' },
    yadira: { name: 'Yadira', file: 'Yadira.fbx' },
    angel: { name: 'Angel', file: 'Angel.fbx' },
    lidia: { name: 'Lidia', file: 'Lidia.fbx' },
    fabian: { name: 'Fabian', file: 'Fabian.fbx' },
    marile: { name: 'Marile', file: 'Marile.fbx' },
    gabriel: { name: 'Gabriel', file: 'Gabriel.fbx' }
};

// Baby shower: every player is the baby (bebe.fbx is only downloaded in that mode)
const BABY_MODEL_FILE = 'bebe.fbx';

const ANIMATION_FILES = {
    walk: 'Meshy_AI_Animation_Walking_withSkin.fbx',
    run: 'Meshy_AI_Animation_Running_withSkin.fbx'
};
const BABY_ANIMATION_FILES = {
    crawling: 'Crawling.fbx'
};

class PaintGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.clock = new THREE.Clock();
        
        this.players = new Map();
        this.gridTexture = null;
        this.gridCanvas = null;
        this.gridCtx = null;
        
        this.socket = null;
        this.roomCode = null;
        this.hud = new PaintHUD();

        // Players that left mid-round (the server keeps them in paint-state until the next round)
        this.departedPlayers = new Set();
        // Grid rendering caches (avoid per-tick allocations)
        this.gridImageData = null;
        this.colorRgbCache = new Map();   // '#rrggbb' -> [r, g, b]
        this.numberRgbMap = new Map();    // player number -> [r, g, b]
        this.floorBaseRgb = [26, 26, 46];

        this.isBabyShower = window.location.search.includes('mode=baby_shower');
        this.baseModels = {};             // characterId -> loaded base model (to clone)
        this.modelLoads = new Map();      // characterId -> Promise<base model> (in flight or done)
        this.baseAnimations = {};
        this.animationsReady = false;

        this.init();
    }

    async init() {
        // Apply baby theme if needed
        const isBabyShower = window.location.search.includes('mode=baby_shower');
        if (isBabyShower) {
            document.documentElement.classList.add('baby-theme');
            const gameTitle = document.querySelector('.game-title');
            if (gameTitle) gameTitle.innerHTML = 'PINTA EL CUARTO';
            document.title = 'Pinta el Cuarto - Baby Shower';
        }

        const bgColor = isBabyShower ? 0xFFEFFA : 0x050510;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(bgColor);
        
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, PAINT_CONFIG.CAMERA_HEIGHT, PAINT_CONFIG.CAMERA_HEIGHT * 0.8);
        this.camera.lookAt(0, 0, 0);
        
        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.getElementById('game-container').appendChild(this.labelRenderer.domElement);
        
        this.setupLights();
        this.createFloor();

        // Animations are small JSON clips and character models load on demand (requestCharacter),
        // so the room is created right away instead of after downloading every character
        const assetsPromise = this.loadAssets();
        this.setupRematchButton();
        this.connectToServer();

        window.addEventListener('resize', () => this.onWindowResize());
        this.animate();
        await assetsPromise;
    }

    setupLights() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        const ambientIntensity = isBabyShower ? 0.8 : 0.6;
        
        const ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
        this.scene.add(ambient);
        
        const sun = new THREE.DirectionalLight(0xffffff, 1);
        sun.position.set(5, 15, 5);
        sun.castShadow = true;
        this.scene.add(sun);
    }

    createFloor() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        
        // Create dynamic texture for the floor
        this.gridCanvas = document.createElement('canvas');
        this.gridCanvas.width = PAINT_CONFIG.GRID_SIZE;
        this.gridCanvas.height = PAINT_CONFIG.GRID_SIZE;
        this.gridCtx = this.gridCanvas.getContext('2d');
        
        // Initial state
        this.floorBaseRgb = isBabyShower ? [255, 255, 255] : [26, 26, 46];
        this.gridImageData = this.gridCtx.createImageData(PAINT_CONFIG.GRID_SIZE, PAINT_CONFIG.GRID_SIZE);
        this.clearGridCanvas();

        this.gridTexture = new THREE.CanvasTexture(this.gridCanvas);
        this.gridTexture.magFilter = THREE.NearestFilter;
        this.gridTexture.minFilter = THREE.NearestFilter;
        
        const geometry = new THREE.PlaneGeometry(PAINT_CONFIG.WORLD_SIZE, PAINT_CONFIG.WORLD_SIZE);
        const material = new THREE.MeshStandardMaterial({ 
            map: this.gridTexture,
            roughness: 0.8,
            metalness: 0.2
        });
        
        const floor = new THREE.Mesh(geometry, material);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Grid lines (optional visual)
        const gridColor = isBabyShower ? 0xE8F4FF : 0x444444;
        const gridHelper = new THREE.GridHelper(PAINT_CONFIG.WORLD_SIZE, PAINT_CONFIG.GRID_SIZE, gridColor, gridColor);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);
    }

    /**
     * Startup assets: only the animation clips (parallel, animation-only JSON).
     * Character models are requested per player (lobby / 'game-started') via requestCharacter().
     */
    async loadAssets() {
        // Baby shower: everyone is the baby, so start that model now (not awaited)
        if (this.isBabyShower) this.requestCharacter('baby');

        const files = this.isBabyShower ? { ...ANIMATION_FILES, ...BABY_ANIMATION_FILES } : ANIMATION_FILES;
        const progressFill = document.getElementById('progress-fill');
        this.baseAnimations = await loadClips(files, (loaded, total) => {
            if (progressFill) progressFill.style.width = `${Math.round((loaded / total) * 100)}%`;
        });
        this.animationsReady = true;

        document.getElementById('loading-screen')?.classList.add('hidden');
    }

    /** Character used when a player has none (or theirs cannot be loaded) */
    get defaultCharacter() {
        return this.isBabyShower ? 'baby' : 'edgar';
    }

    getCharacterFile(characterId) {
        if (characterId === 'baby') return this.isBabyShower ? BABY_MODEL_FILE : null;
        return CHARACTER_MODELS[characterId]?.file || null;
    }

    /**
     * Start (or reuse) the download of a character's model. Cached per character, so it can be
     * called on every event/tick. Resolves with the base model to clone; an unknown or failed
     * character resolves with the default model (baby shower: baby), and that with Edgar.
     */
    requestCharacter(characterId) {
        const id = characterId || this.defaultCharacter;
        let promise = this.modelLoads.get(id);
        if (promise) return promise;

        const file = this.getCharacterFile(id);
        const fallback = id === 'edgar' ? null : (id === this.defaultCharacter ? 'edgar' : this.defaultCharacter);
        promise = (file ? loadModel(file) : Promise.reject(new Error(`no model file for "${id}"`)))
            .catch(err => {
                if (!fallback) throw err;
                console.warn(`[Paint] Model "${id}" unavailable, using "${fallback}"`, err);
                return this.requestCharacter(fallback);
            })
            .then(model => {
                this.baseModels[id] = model;
                return model;
            });
        promise.catch(err => {
            console.error(`[Paint] Could not load a model for "${id}"`, err);
            // Allow a retry later (not on every tick)
            setTimeout(() => this.modelLoads.delete(id), 5000);
        });
        this.modelLoads.set(id, promise);
        return promise;
    }

    /** Start downloading the characters of a player list (lobby room info / 'game-started') */
    preloadCharacters(players) {
        if (!Array.isArray(players)) return;
        players.forEach(p => {
            if (p && p.character) this.requestCharacter(p.character);
        });
    }

    connectToServer() {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => {
            this.socket = io(SERVER_URL, {
                transports: ['websocket'],
                reconnection: true
            });
            installParty(this.socket); // Modo Fiesta: 'party-go' navigation + badge
            // Modo Fiesta: the server moves the host on; no "back to menu" from the results panel
            if (isPartyMode()) {
                const menuBtn = document.getElementById('btn-return-menu');
                if (menuBtn) menuBtn.style.display = 'none';
            }

            this.socket.on('connect', () => {
                // Recovered reconnect: same socket id and room, missed events are replayed.
                // Creating a room here would orphan every phone.
                if (this.socket.recovered) {
                    console.log('[Paint] Connection recovered, keeping room', this.roomCode);
                    return;
                }
                console.log('Connected to server');

                const urlParams = new URLSearchParams(window.location.search);
                this.roomCode = urlParams.get('room');
                const isHost = urlParams.get('host') === 'true' || !this.roomCode;

                if (isHost && !this.roomCode) {
                    // Create a new room if none provided (in a party this re-attaches to the existing room)
                    const isBabyShower = document.documentElement.classList.contains('baby-theme');
                    openRoom(this.socket, 'paint', {
                        isBabyShower: isBabyShower
                    }, (response) => {
                        if (response && response.success) {
                            this.roomCode = response.roomCode;
                            console.log('Room ready:', this.roomCode);
                            this.showRoomCode(this.roomCode);
                        } else {
                            console.error('Failed to create room:', response);
                        }
                    });
                } else {
                    this.socket.emit('join-room', { roomCode: this.roomCode, playerName: 'Host-Screen' });
                }
            });

            this.socket.on('paint-state', (state) => {
                this.updateState(state);
            });

            this.socket.on('paint-game-over', (state) => {
                this.hud.showResults(state.results, state.winner);
                this.hud.setEndButtonsVisible(true);
            });

            this.socket.on('round-starting', (data) => {
                console.log('[Paint] Round starting:', data);
                if (data && data.rematch) {
                    this.resetForNewMatch();
                }
                if (data) this.hud.updateRound(data.round, data.totalRounds);
            });

            this.socket.on('game-started', (data) => {
                console.log('[Paint] Game started signal received');
                const overlay = document.getElementById('room-code-overlay');
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.style.display = 'none';
                }
                // Models normally started downloading in the lobby; this covers defaults/late picks
                this.preloadCharacters(data && data.players);
                // New match or new tournament round: fresh floor, HUD and player set
                this.resetForNewMatch(data && data.players);
                if (data) this.hud.updateRound(data.currentRound || 1, data.tournamentRounds || 1);
            });

            this.socket.on('player-joined', (data) => {
                console.log('Player joined:', data);
                // Download the characters already chosen while the lobby is open
                this.preloadCharacters(data && data.room && data.room.players);
                // Update player count if lobby is visible
                const playerCountElem = document.getElementById('player-count');
                const startBtn = document.getElementById('start-game-btn');
                if (data.room && playerCountElem) {
                    playerCountElem.textContent = `Jugadores: ${data.room.playerCount} / 8`;
                    if (data.room.playerCount >= 1 && startBtn) {
                        startBtn.disabled = false;
                        startBtn.textContent = 'EMPEZAR JUEGO';
                    }
                }
            });

            this.socket.on('character-selected', (data) => {
                // Start this character's model download during the lobby
                if (data && data.character) this.requestCharacter(data.character);
            });

            this.socket.on('player-left', (data) => {
                console.log('Player left:', data);
                if (data && data.playerId) {
                    this.departedPlayers.add(data.playerId);
                    this.removePlayer(data.playerId);
                }
                const playerCountElem = document.getElementById('player-count');
                const startBtn = document.getElementById('start-game-btn');
                if (data.room && playerCountElem) {
                    playerCountElem.textContent = `Jugadores: ${data.room.playerCount} / 8`;
                    if (data.room.playerCount < 1 && startBtn) {
                        startBtn.disabled = true;
                        startBtn.textContent = 'ESPERANDO JUGADORES...';
                    }
                }
            });

            this.socket.on('round-ended', (data) => {
                if (data.gameMode && data.gameMode !== 'paint') return;
                this.hud.showResults(data.paintResults, { id: data.roundWinnerId, name: data.roundWinner });
                this.hud.setEndButtonsVisible(false);
                this.hud.showNextRoundCountdown(5);
            });

            this.socket.on('tournament-ended', (data) => {
                if (data.gameMode && data.gameMode !== 'paint') return;
                // tournamentWinner is a player name (string); showResults resolves the color from the results
                const winner = data.tournamentWinner ? { name: data.tournamentWinner } : null;
                this.hud.showResults(data.paintResults, winner);
                this.hud.hideNextRoundCountdown();
                this.hud.setEndButtonsVisible(true);
            });
        };
        document.head.appendChild(script);
    }

    /**
     * Wire the REVANCHA button once (it lives in paint.html, so it is never duplicated)
     */
    setupRematchButton() {
        const btn = document.getElementById('btn-rematch');
        if (!btn || btn.dataset.wired) return;
        btn.dataset.wired = 'true';
        btn.addEventListener('click', () => {
            if (!this.socket || btn.disabled) return;
            this.hud.setRematchPending(true);
            this.socket.emit('request-rematch', (res) => {
                if (res && res.success) {
                    console.log('[Paint] Rematch accepted');
                    return; // 'round-starting' (rematch) resets the screen
                }
                console.warn('[Paint] Rematch failed:', res);
                this.hud.setRematchPending(true, (res && res.error) ? 'NO SE PUDO' : 'ERROR');
                setTimeout(() => this.hud.setRematchPending(false), 1500);
            });
        });
    }

    /**
     * Back to a fresh match: hide results, reset HUD and floor, sync players.
     * @param {Array} [playersData] - players from 'game-started'; when given, models of players
     *                                no longer in the match are removed.
     */
    resetForNewMatch(playersData) {
        this.hud.reset();
        this.clearGridCanvas();

        if (Array.isArray(playersData)) {
            const ids = new Set(playersData.map(p => p.id));
            Array.from(this.players.keys()).forEach(id => {
                if (!ids.has(id)) this.removePlayer(id);
            });
            // The new server state only contains current players
            this.departedPlayers.clear();
        }

        // Stop walk cycles; positions come from the next paint-state
        this.players.forEach(p => p.animController.updateFromMovementState({
            isMoving: false, isRunning: false, isGrounded: true
        }));
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;
        // CSS2D label elements are not removed from the DOM when the parent model is removed
        player.model.traverse(obj => {
            if (obj.isCSS2DObject && obj.element) obj.element.remove();
        });
        this.scene.remove(player.model);
        player.animController.dispose?.();
        this.players.delete(playerId);
    }

    clearGridCanvas() {
        if (!this.gridCtx || !this.gridImageData) return;
        const px = this.gridImageData.data;
        const [r, g, b] = this.floorBaseRgb;
        for (let i = 0; i < px.length; i += 4) {
            px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
        }
        this.gridCtx.putImageData(this.gridImageData, 0, 0);
        if (this.gridTexture) this.gridTexture.needsUpdate = true;
    }

    getRgb(colorHex) {
        let rgb = this.colorRgbCache.get(colorHex);
        if (!rgb) {
            const c = new THREE.Color(colorHex);
            rgb = [Math.floor(c.r * 255), Math.floor(c.g * 255), Math.floor(c.b * 255)];
            this.colorRgbCache.set(colorHex, rgb);
        }
        return rgb;
    }

    showRoomCode(code) {
        let overlay = document.getElementById('room-code-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'room-code-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(10, 10, 21, 0.95);
                border: 4px solid #ffffff;
                border-radius: 24px;
                padding: 40px;
                text-align: center;
                font-family: 'Orbitron', sans-serif;
                z-index: 2000;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
                min-width: 400px;
                box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
            `;
            document.body.appendChild(overlay);
        }
        
        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mobileUrl)}&bgcolor=ffffff`;

        overlay.innerHTML = `
            <h2 style="color: #ffffff; margin: 0; font-size: 1.5rem;">PINTA EL PISO</h2>
            <div id="room-code-display" style="font-size: 4rem; color: #ffff00; letter-spacing: 10px; font-weight: 900;">${code}</div>
            
            <div style="background: white; padding: 15px; border-radius: 16px; margin: 10px 0; box-shadow: 0 0 20px rgba(255,255,255,0.2);">
                <img src="${qrCodeUrl}" alt="QR Code" style="display: block; width: 200px; height: 200px;" />
            </div>

            <p style="color: rgba(255,255,255,0.6); margin: 0;">Escanea para unirte a la batalla</p>
            <div id="player-count" style="font-size: 1.2rem; color: white; margin-top: 10px;">Jugadores: 0 / 8</div>
            
            <div style="width: 100%; margin-top: 10px;">
                <button id="start-game-btn" style="
                    background: #ffff00;
                    color: black;
                    border: none;
                    padding: 15px 30px;
                    border-radius: 12px;
                    font-family: 'Orbitron', sans-serif;
                    font-size: 1.2rem;
                    font-weight: 700;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.3s;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                " disabled>ESPERANDO JUGADORES...</button>
            </div>
        `;

        const startBtn = document.getElementById('start-game-btn');
        startBtn.addEventListener('click', () => {
            console.log('[Paint] Start button clicked');
            this.socket.emit('start-game', (response) => {
                if (response && response.success) {
                    console.log('[Paint] Game started successfully');
                } else {
                    console.error('[Paint] Failed to start game:', response);
                }
            });
        });
    }

    updateState(state) {
        // The final tick carries only {winner, results} (no players/grid); results come via game-over events
        if (!state || !Array.isArray(state.players)) return;

        if (state.roundState === 'active') {
            this.hud.updateTimer(state.timeLeft);
            this.applyGridState(state);
            this.hud.updateScores(state.players);
        }

        state.players.forEach(playerData => {
            if (this.departedPlayers.has(playerData.id)) return;
            let player = this.players.get(playerData.id);
            if (!player) {
                player = this.createPlayer(playerData);
                // Model still downloading: the player appears on a later tick once it is ready
                if (!player) return;
                this.players.set(playerData.id, player);
            }
            
            player.model.position.copy(playerData.position);
            player.model.rotation.y = playerData.facingAngle;
            
            // Update animations based on movement from server
            player.animController.updateFromMovementState({
                isMoving: playerData.isMoving,
                isRunning: false,
                isGrounded: true
            });
        });
    }

    /**
     * Build a player's model. Returns null (and makes sure the download is running) while the
     * character model or the animations are not loaded yet; updateState retries every tick.
     */
    createPlayer(data) {
        const characterId = data.character || this.defaultCharacter;
        const baseModel = this.baseModels[characterId];
        if (!baseModel || !this.animationsReady) {
            this.requestCharacter(characterId);
            return null;
        }
        const model = SkeletonUtils.clone(baseModel);
        model.scale.set(0.01, 0.01, 0.01);
        
        // Apply color
        model.traverse(child => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.emissive = new THREE.Color(data.color);
                child.material.emissiveIntensity = 0.2;
                child.castShadow = true;
            }
        });

        // Add Name Label
        const div = document.createElement('div');
        div.className = 'paint-player-name-label';
        div.textContent = data.name || `P${data.number}`;
        div.style.color = data.color;
        const label = new CSS2DObject(div);
        label.position.set(0, 220, 0); // Position above character head
        model.add(label);

        this.scene.add(model);
        
        const animController = new AnimationController(model, this.baseAnimations);
        
        return { model, animController, label };
    }

    /**
     * The server sends only the painted cells each tick (state.gridChanges = [index, playerNumber, ...])
     * and the full grid once per second (state.grid). Keep a local copy and repaint from it.
     */
    applyGridState(state) {
        if (Array.isArray(state.grid) || state.grid instanceof ArrayBuffer) {
            const full = state.grid instanceof ArrayBuffer ? new Int8Array(state.grid) : state.grid;
            if (!this.localGrid || this.localGrid.length !== full.length) this.localGrid = new Int8Array(full.length);
            this.localGrid.set(full);
        }
        const changes = state.gridChanges;
        if (this.localGrid && Array.isArray(changes)) {
            for (let i = 0; i + 1 < changes.length; i += 2) {
                const idx = changes[i];
                if (idx >= 0 && idx < this.localGrid.length) this.localGrid[idx] = changes[i + 1];
            }
        }
        const changed = Array.isArray(state.grid) || (Array.isArray(changes) && changes.length > 0);
        if (this.localGrid && changed) this.updateGrid(this.localGrid, state.players);
    }

    updateGrid(gridData, players) {
        if (!gridData || !this.gridImageData) return;

        // Map player numbers to cached RGB triplets (one THREE.Color per distinct color, ever)
        const numberRgb = this.numberRgbMap;
        numberRgb.clear();
        for (let i = 0; i < players.length; i++) {
            numberRgb.set(players[i].number, this.getRgb(players[i].color || '#ffffff'));
        }
        const fallbackRgb = this.getRgb('#ffffff');
        const baseRgb = this.floorBaseRgb;

        // Handle both regular arrays and TypedArrays/Buffers
        const data = (gridData instanceof ArrayBuffer) ? new Int8Array(gridData) : gridData;

        const px = this.gridImageData.data;
        const len = Math.min(data.length, px.length / 4);
        for (let i = 0; i < len; i++) {
            const playerNum = data[i];
            const rgb = playerNum === -1 ? baseRgb : (numberRgb.get(playerNum) || fallbackRgb);
            const p = i * 4;
            px[p] = rgb[0];
            px[p + 1] = rgb[1];
            px[p + 2] = rgb[2];
            px[p + 3] = 255;
        }

        this.gridCtx.putImageData(this.gridImageData, 0, 0);
        this.gridTexture.needsUpdate = true;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock.getDelta();
        
        this.players.forEach(p => p.animController.update(delta));
        
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}

// Start game
new PaintGame();

