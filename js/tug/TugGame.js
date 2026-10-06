/**
 * GUERRA DE CUERDA - Tug of War Game Mode
 * Three.js based tug of war game
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController, ANIMATION_CONFIG } from '../animation/AnimationController.js';
import { loadClips, loadModel } from '../assets/AssetLoader.js';

const TUG_CONFIG = {
    ROPE_LENGTH: 30, // Reduced from 40
    WIN_DISTANCE: 100, // From server
    PLAYER_SPACING: 2.5,
    SIDE_OFFSET: 5,
    CAMERA_HEIGHT: 12,
    CAMERA_DISTANCE: 25
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
    gabriel: { name: 'Gabriel', file: 'Gabriel.fbx' },
    baby: { name: 'Bebé', file: 'bebe.fbx' } // Baby shower only (see characterIdFor)
};

// Loaded as small animation-only JSON clips by AssetLoader
const ANIMATION_FILES = {
    idle: 'Meshy_AI_Animation_Boxing_Guard_Prep_Straight_Punch_withSkin.fbx',
    pull: 'Meshy_AI_Animation_Grab_Held_withSkin.fbx', // Effort/Pulling
    win: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx',
    lose: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx'
};

// Baby shower only
const BABY_ANIMATION_FILES = {
    crawling: 'Crawling.fbx'
};

// Escape text before inserting it with innerHTML (defense in depth; names are sanitized server-side)
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class TugPlayerEntity {
    constructor(id, number, color, team, baseModel, baseAnimations) {
        this.id = id;
        this.number = number;
        this.color = color;
        this.team = team;
        this.name = `Player ${number}`;
        
        this.model = SkeletonUtils.clone(baseModel);
        // Correct scale and orientation (using negative Z like in main game to fix upside-down issue)
        this.model.scale.set(0.01, 0.01, -0.01);
        
        this.applyColorTint(color);
        
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);
        
        this.animController = new AnimationController(this.model, baseAnimations);
        this.animController.play('idle'); // Ensure idle plays immediately
        this.isPulling = false;
        this.pullEndTime = 0;
        this.homeX = 0;          // Position relative to the rope center
        this.finalAnim = null;   // 'win' / 'lose' once the match is over
    }
    
    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'tug-player-name-label';
        div.textContent = this.name;
        div.style.color = color;
        const label = new CSS2DObject(div);
        label.position.set(0, 220, 0); // Corrected height for 0.01 scale
        return label;
    }
    
    applyColorTint(color) {
        const tintColor = new THREE.Color(color);
        // Materials can be arrays on some FBX meshes (e.g. bebe.fbx)
        const cloneMat = (m) => {
            const mat = m.clone();
            if (mat.emissive) {
                mat.emissive = tintColor;
                mat.emissiveIntensity = 0.2;
            }
            return mat;
        };
        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.material = Array.isArray(child.material)
                    ? child.material.map(cloneMat)
                    : cloneMat(child.material);
            }
        });
    }

    setName(name) {
        this.name = name;
        if (this.nameLabel && this.nameLabel.element) {
            this.nameLabel.element.textContent = name;
        }
    }

    /**
     * Apply a server snapshot (no animation work here)
     */
    applyState(state) {
        if (state && state.pullQuality > 0) {
            this.isPulling = true;
            this.pullEndTime = Date.now() + 500;
        }
    }

    /**
     * Final win/lose animation; keeps playing after the server stops sending state
     */
    setFinalAnim(animName) {
        this.finalAnim = animName;
        this.isPulling = false;
        if (animName === 'lose') {
            // Fall once and stay down instead of looping the fall
            const action = this.animController.actions.lose;
            if (action) {
                action.setLoop(THREE.LoopOnce);
                action.clampWhenFinished = true;
            }
        }
        this.animController.play(animName, 0.2);
    }

    clearFinalAnim() {
        this.finalAnim = null;
        this.isPulling = false;
        this.animController.play('idle', 0.2);
    }

    /**
     * Per-frame update from the render loop (single shared delta)
     */
    tick(delta) {
        if (!this.finalAnim) {
            if (this.isPulling && Date.now() > this.pullEndTime) {
                this.isPulling = false;
            }
            // play() is a no-op if the animation is already running
            this.animController.play(this.isPulling ? 'pull' : 'idle', 0.1);
        }
        this.animController.update(delta);
    }

    dispose() {
        this.animController?.dispose();
        this.nameLabel?.element?.parentNode?.removeChild(this.nameLabel.element);
    }
}

class TugGame {
    constructor() {
        this.players = new Map();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.clock = new THREE.Clock();
        this.socket = null;
        this.roomCode = null;
        this.gameStarted = false;
        
        this.isBabyShower = window.location.search.includes('mode=baby_shower');
        this.defaultCharacterId = this.isBabyShower ? 'baby' : 'edgar';
        this.baseModels = {};      // characterId -> loaded base model (only the ones requested)
        this.baseAnimations = {};

        // Players whose character model is still downloading when the match starts.
        // setupGeneration invalidates loads from a previous setup (rematch, lost session).
        this.pendingPlayers = new Map();   // id -> player data
        this.setupGeneration = 0;
        this.finalWinnerTeam = null;       // 'left' / 'right' / 'draw' once the match is over

        this.rope = null;
        this.marker = null;
        this.markerPos = 0;
        this.ropeTargetX = 0;   // World X the rope should reach (from server markerPos)
        this.ropeX = 0;         // Smoothed world X of rope, marker and teams
        this.rematchPending = false;

        this.init();
    }

    async init() {
        // Apply baby theme if needed
        if (this.isBabyShower) {
            document.documentElement.classList.add('baby-theme');
            const gameTitle = document.querySelector('.game-title');
            if (gameTitle) gameTitle.innerHTML = 'GUERRA DE BIBERONES';
            document.title = 'Guerra de Biberones - Baby Shower';
        }

        this.setupScene();
        this.setupLights();
        this.createArena();
        
        await this.loadAssets();
        this.connectToServer();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a15);
        this.scene.fog = new THREE.Fog(0x0a0a15, 30, 100);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, TUG_CONFIG.CAMERA_HEIGHT, TUG_CONFIG.CAMERA_DISTANCE);
        this.camera.lookAt(0, 2, 0);

        this.renderer = new THREE.WebGLRenderer({ 
            canvas: document.getElementById('game-canvas'),
            antialias: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.getElementById('game-container').appendChild(this.labelRenderer.domElement);
        
        this.addStyles();
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .tug-player-name-label {
                color: white;
                font-family: 'Orbitron', sans-serif;
                font-size: 10px;
                font-weight: bold;
                text-shadow: 0 0 10px rgba(0,0,0,0.8);
                padding: 2px 8px;
                background: rgba(0,0,0,0.6);
                border-radius: 5px;
                border: 1px solid currentColor;
                white-space: nowrap;
                pointer-events: none;
                text-transform: uppercase;
            }
            .rhythm-hud {
                position: fixed;
                top: 15%; /* Adjusted to be above the modal title area */
                left: 50%;
                transform: translateX(-50%);
                width: 400px;
                height: 40px;
                background: rgba(0,0,0,0.5);
                border: 2px solid rgba(255,255,255,0.2);
                border-radius: 20px;
                overflow: hidden;
                display: flex;
                align-items: center;
                z-index: 10;
            }
            .rhythm-target {
                position: absolute;
                width: 80px;
                height: 100%;
                background: rgba(0, 255, 204, 0.4);
                left: 160px;
                box-shadow: 0 0 20px rgba(0, 255, 204, 0.5);
                border-left: 2px solid #00ffcc;
                border-right: 2px solid #00ffcc;
            }
            .rhythm-cursor {
                position: absolute;
                width: 4px;
                height: 100%;
                background: white;
                box-shadow: 0 0 10px white;
            }
            .tug-status {
                position: fixed;
                top: 80px; /* Adjusted to avoid overlap */
                left: 50%;
                transform: translateX(-50%);
                font-family: 'Orbitron', sans-serif;
                font-size: 2.5rem;
                font-weight: 900;
                color: white;
                text-align: center;
                pointer-events: none;
                z-index: 10;
                text-shadow: 0 0 20px #9966ff;
            }
            .tug-countdown {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-family: 'Orbitron', sans-serif;
                font-size: 10rem;
                font-weight: 900;
                color: white;
                text-shadow: 0 0 50px #9966ff;
                z-index: 100;
                pointer-events: none;
                display: none;
            }
            .tug-timer {
                position: fixed;
                top: 240px;
                left: 50%;
                transform: translateX(-50%);
                font-family: 'Orbitron', sans-serif;
                font-size: 3rem;
                font-weight: 900;
                color: white;
                background: rgba(0,0,0,0.5);
                padding: 10px 30px;
                border-radius: 50px;
                border: 2px solid #9966ff;
                text-shadow: 0 0 10px #9966ff;
                z-index: 10;
                display: none;
            }
            .tug-timer.low-time {
                color: #ff3366;
                border-color: #ff3366;
                text-shadow: 0 0 20px #ff3366;
                animation: pulse-red 1s infinite alternate;
            }
            @keyframes pulse-red {
                from { transform: translateX(-50%) scale(1); }
                to { transform: translateX(-50%) scale(1.1); }
            }
            #tug-rematch-panel {
                position: fixed;
                bottom: 12%;
                left: 50%;
                transform: translateX(-50%);
                display: none;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                z-index: 150;
                pointer-events: auto;
            }
            #tug-rematch-panel.visible { display: flex; }
            #tug-rematch-btn {
                padding: 15px 50px;
                font-family: 'Orbitron', sans-serif;
                font-size: 1.3rem;
                font-weight: 900;
                letter-spacing: 3px;
                background: linear-gradient(135deg, #9966ff, #ff3366);
                color: #fff;
                border: none;
                border-radius: 50px;
                cursor: pointer;
                box-shadow: 0 0 25px rgba(153, 102, 255, 0.6);
                transition: all 0.3s ease;
            }
            #tug-rematch-btn:not(:disabled):hover {
                transform: scale(1.05);
                box-shadow: 0 0 35px rgba(153, 102, 255, 0.9);
            }
            #tug-rematch-btn:disabled { opacity: 0.6; cursor: wait; }
            #tug-rematch-error {
                min-height: 1.2em;
                font-family: 'Orbitron', sans-serif;
                font-size: 0.85rem;
                color: #ff3366;
                text-shadow: 0 0 6px rgba(0,0,0,0.8);
            }
        `;
        document.head.appendChild(style);
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
    }

    createArena() {
        // Floor
        const floorGeo = new THREE.PlaneGeometry(100, 40);
        const floorMat = new THREE.MeshPhongMaterial({ color: 0x111122 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Lines
        const centerLineGeo = new THREE.PlaneGeometry(0.2, 40);
        const centerLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
        const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.y = 0.01;
        this.scene.add(centerLine);

        // Win zones
        const createWinZone = (x, color) => {
            const zoneGeo = new THREE.PlaneGeometry(5, 40);
            const zoneMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.2 });
            const zone = new THREE.Mesh(zoneGeo, zoneMat);
            zone.rotation.x = -Math.PI / 2;
            zone.position.set(x, 0.01, 0);
            this.scene.add(zone);
        };
        createWinZone(-25, 0xff3366);
        createWinZone(25, 0x00ffcc);

        // Procedural Rope Texture
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        // Base color
        ctx.fillStyle = '#8b4513';
        ctx.fillRect(0, 0, 128, 128);
        // Strands pattern
        ctx.strokeStyle = '#5d2e0c';
        ctx.lineWidth = 10;
        for(let i = -128; i < 128; i += 20) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 128, 128);
            ctx.stroke();
        }
        
        const ropeTex = new THREE.CanvasTexture(canvas);
        ropeTex.wrapS = THREE.RepeatWrapping;
        ropeTex.wrapT = THREE.RepeatWrapping;
        ropeTex.repeat.set(10, 1);

        // Rope
        const ropeGeo = new THREE.CylinderGeometry(0.15, 0.15, TUG_CONFIG.ROPE_LENGTH, 12, 1, true);
        const ropeMat = new THREE.MeshStandardMaterial({ 
            map: ropeTex,
            roughness: 0.8,
            metalness: 0.1
        });
        this.rope = new THREE.Mesh(ropeGeo, ropeMat);
        this.rope.rotation.z = Math.PI / 2;
        this.rope.position.y = 1.2; // Lowered to align with character hands
        this.scene.add(this.rope);

        // Marker (the flag on the rope)
        const markerGeo = new THREE.BoxGeometry(0.5, 1, 0.5);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        this.marker = new THREE.Mesh(markerGeo, markerMat);
        this.marker.position.y = 1.2; // Lowered to match rope
        this.scene.add(this.marker);
    }

    /**
     * Startup assets: only the animation clips (small JSON, in parallel) block the loading
     * screen. The default character starts downloading in the background; every other
     * character is fetched when a player joins/selects it (see prefetchCharacters).
     */
    async loadAssets() {
        const fill = document.getElementById('progress-fill');
        const files = this.isBabyShower
            ? { ...ANIMATION_FILES, ...BABY_ANIMATION_FILES }
            : ANIMATION_FILES;

        // Fallback model + most common pick; never blocks room creation
        this.prefetchCharacters([this.defaultCharacterId]);

        this.baseAnimations = await loadClips(files, (loaded, total) => {
            if (fill) fill.style.width = `${(loaded / total) * 100}%`;
        });

        document.getElementById('loading-screen')?.classList.add('hidden');
    }

    // =================================
    // Character models (loaded on demand, cached by AssetLoader)
    // =================================

    /** Known character id for this page (unknown ids and baby outside baby shower -> default) */
    characterIdFor(characterId) {
        if (characterId === 'baby' && !this.isBabyShower) return this.defaultCharacterId;
        return CHARACTER_MODELS[characterId] ? characterId : this.defaultCharacterId;
    }

    /** Download (or reuse) a character model; resolves with the shared base model */
    loadCharacter(characterId) {
        const id = this.characterIdFor(characterId);
        return loadModel(CHARACTER_MODELS[id].file).then(model => {
            this.baseModels[id] = model;
            return model;
        });
    }

    /** Fire-and-forget download of the given characters (lobby: joins and selections) */
    prefetchCharacters(characterIds) {
        new Set(characterIds.filter(Boolean).map(id => this.characterIdFor(id))).forEach(id => {
            if (this.baseModels[id]) return;
            this.loadCharacter(id).catch(err => console.warn(`[Tug] Could not preload ${id}:`, err));
        });
    }

    /** Model for a character, falling back to the default (or any loaded) model. Never rejects. */
    async resolveCharacterModel(characterId) {
        const id = this.characterIdFor(characterId);
        if (this.baseModels[id]) return this.baseModels[id];
        try {
            return await this.loadCharacter(id);
        } catch (err) {
            console.warn(`[Tug] Model ${id} failed, using default:`, err);
        }
        if (id !== this.defaultCharacterId) {
            try {
                return await this.loadCharacter(this.defaultCharacterId);
            } catch (err) {
                console.warn('[Tug] Default model failed too:', err);
            }
        }
        return Object.values(this.baseModels)[0] || null;
    }

    connectToServer() {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => {
            this.socket = io(SERVER_URL);
            this.socket.on('connect', () => {
                // Recovered connection (Socket.IO connectionStateRecovery): same id, same room,
                // missed events are replayed. Creating a room here would orphan all phones.
                if (this.socket.recovered) {
                    console.log(`[Tug] Connection recovered, keeping room ${this.roomCode}`);
                    return;
                }

                // Reconnected but the session could not be recovered: the old room is gone
                if (this.roomCode) {
                    console.warn('[Tug] Session lost, creating a new room');
                    this.cleanupGame();
                    this.gameStarted = false;
                }

                const isBabyShower = document.documentElement.classList.contains('baby-theme');
                this.socket.emit('create-room', {
                    gameMode: 'tug',
                    isBabyShower: isBabyShower
                }, (response) => {
                    if (response.success) {
                        this.roomCode = response.roomCode;
                        this.showRoomUI(this.roomCode);
                    }
                });
            });

            // Lobby counters (registered once, not per room UI)
            this.socket.on('player-joined', (data) => {
                this.updateLobbyCount(data?.room?.playerCount ?? this.players.size);
                // Download characters already known during the lobby (baby shower auto-assigns)
                const roomPlayers = data?.room?.players || [data?.player];
                this.prefetchCharacters(roomPlayers.map(p => p?.character));
            });
            this.socket.on('character-selected', (data) => {
                this.prefetchCharacters([data?.character]);
            });
            this.socket.on('player-left', (data) => {
                this.pendingPlayers.delete(data?.playerId);
                this.updateLobbyCount(data?.room ? data.room.playerCount : this.players.size);
            });

            // Rematch (and tournament rounds): announced ~1 s before 'game-started'
            this.socket.on('round-starting', (data) => {
                console.log('[Tug] Round starting', data);
                this.hideRematchPanel();
                this.finalWinnerTeam = null;
                this.ropeTargetX = 0;
                this.players.forEach(entity => entity.clearFinalAnim());
                const status = document.getElementById('tug-game-status');
                if (status) status.textContent = data?.rematch ? '¡REVANCHA!' : '¡PREPÁRENSE!';
            });

            this.socket.on('game-started', (data) => {
                this.cleanupGame();
                this.gameStarted = true;
                this.hideRoomUI();
                this.setupPlayers(data.players || []);
                this.setupRhythmHUD();
            });

            this.socket.on('tug-state', (state) => this.updateGameState(state));
            this.socket.on('tug-game-over', (data) => this.showGameOver(data));
        };
        document.head.appendChild(script);
    }

    showRoomUI(code) {
        this.hideRoomUI(); // Never stack overlays (e.g. new room after a lost session)
        const overlay = document.createElement('div');
        overlay.id = 'tug-room-overlay';
        overlay.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(10, 10, 21, 0.95); border: 4px solid #9966ff; border-radius: 24px;
            padding: 40px; text-align: center; font-family: 'Orbitron', sans-serif; z-index: 100;
            display: flex; flex-direction: column; align-items: center; gap: 20px;
            min-width: 400px; box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
        `;

        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mobileUrl)}&bgcolor=ffffff`;

        overlay.innerHTML = `
            <h1 style="color: #9966ff; margin: 0;">GUERRA DE CUERDA</h1>
            <div style="font-size: 4rem; color: white; letter-spacing: 10px; font-weight: 900;">${code}</div>
            
            <div style="background: white; padding: 15px; border-radius: 16px; margin: 10px 0; box-shadow: 0 0 20px rgba(255,255,255,0.2);">
                <img src="${qrCodeUrl}" alt="QR Code" style="display: block; width: 200px; height: 200px;" />
            </div>

            <p style="color: rgba(255,255,255,0.6); margin: 0;">Escanea para unirte al equipo</p>
            <div id="player-count" style="font-size: 1.2rem; color: white;">Jugadores: 0 / 8</div>
            
            <button id="start-btn" style="
                padding: 15px 40px; background: #9966ff; border: none; border-radius: 12px;
                color: white; font-family: 'Orbitron'; font-size: 1.2rem; cursor: pointer;
                width: 100%; transition: all 0.3s; text-transform: uppercase; letter-spacing: 2px;
            " disabled>ESPERANDO JUGADORES...</button>
        `;
        document.body.appendChild(overlay);

        document.getElementById('start-btn').onclick = () => this.socket.emit('start-game');
    }

    updateLobbyCount(count) {
        const playerCountElem = document.getElementById('player-count');
        if (playerCountElem) playerCountElem.textContent = `Jugadores: ${count} / 8`;

        const btn = document.getElementById('start-btn');
        if (btn) {
            if (count >= 2) {
                btn.disabled = false;
                btn.textContent = '¡INICIAR!';
            } else {
                btn.disabled = true;
                btn.textContent = 'ESPERANDO JUGADORES...';
            }
        }
    }

    hideRoomUI() {
        document.getElementById('tug-room-overlay')?.remove();
    }

    cleanupGame() {
        // Remove players from scene and dispose resources
        this.players.forEach(entity => {
            if (entity.model) {
                this.scene.remove(entity.model);
                entity.dispose();
            }
        });
        this.players.clear();
        this.hideRematchPanel();

        // Drop entities still waiting for their model (they belong to the old setup)
        this.setupGeneration++;
        this.pendingPlayers.clear();
        this.finalWinnerTeam = null;

        // Clear existing UI elements to prevent overlap
        const elementsToRemove = [
            '.rhythm-hud',
            '#tug-game-status',
            '#tug-countdown',
            '#tug-timer',
            '.tug-player-name-label' // Clear player labels from previous game
        ];
        
        elementsToRemove.forEach(selector => {
            const els = document.querySelectorAll(selector);
            els.forEach(el => el.remove());
        });

        // Reset positions
        this.markerPos = 0;
        this.ropeTargetX = 0;
        this.ropeX = 0;
        if (this.marker) this.marker.position.x = 0;
        if (this.rope) this.rope.position.x = 0;
    }

    setupPlayers(playersData) {
        // Find which players are on which team to position them
        const teams = { left: [], right: [] };
        const assignedPlayers = playersData.map(p => {
            const team = p.team || (teams.left.length <= teams.right.length ? 'left' : 'right');
            const playerWithTeam = { ...p, team };
            teams[team].push(playerWithTeam);
            return playerWithTeam;
        });

        const generation = this.setupGeneration;

        assignedPlayers.forEach((p) => {
            // Position based on team and index (fixed even if the model arrives later)
            const teamPlayers = teams[p.team];
            const pIdx = teamPlayers.findIndex(tp => tp.id === p.id);
            const x = (p.team === 'left' ? -1 : 1) * (TUG_CONFIG.SIDE_OFFSET + pIdx * TUG_CONFIG.PLAYER_SPACING);
            const z = (pIdx % 2 === 0 ? 1 : -1) * 0.8; // Closer to the rope

            const readyModel = this.baseModels[this.characterIdFor(p.character)];
            if (readyModel) {
                this.createPlayerEntity(p, x, z, readyModel);
                return;
            }

            // Model still downloading: create the entity as soon as it arrives
            this.pendingPlayers.set(p.id, p);
            this.resolveCharacterModel(p.character).then(model => {
                // Stale (rematch, lost session) or the player left meanwhile
                if (generation !== this.setupGeneration || this.pendingPlayers.get(p.id) !== p) return;
                this.pendingPlayers.delete(p.id);
                if (!model) {
                    console.error(`[Tug] No model available for player ${p.name}`);
                    return;
                }
                const entity = this.createPlayerEntity(p, x, z, model);
                if (this.finalWinnerTeam) {
                    entity.setFinalAnim(this.finalAnimFor(entity));
                }
            });
        });
    }

    createPlayerEntity(p, x, z, baseModel) {
        const entity = new TugPlayerEntity(p.id, p.number, p.color, p.team, baseModel, this.baseAnimations);
        entity.setName(p.name);

        this.players.set(p.id, entity);
        this.scene.add(entity.model);

        entity.homeX = x; // Teams slide with the rope from this offset (see animate)
        entity.model.position.set(x + this.ropeX, 0.8, z); // Raised even more to align hands perfectly with rope at 1.2
        // Swapped signs: Left team faces X+, Right team faces X-
        entity.model.rotation.y = (p.team === 'left' ? -1 : 1) * Math.PI / 2;
        return entity;
    }

    /** Final animation for an entity once the match is over */
    finalAnimFor(entity) {
        if (this.finalWinnerTeam === 'draw') return 'idle';
        return entity.team === this.finalWinnerTeam ? 'win' : 'lose';
    }

    setupRhythmHUD() {
        const hud = document.createElement('div');
        hud.className = 'rhythm-hud';
        hud.innerHTML = `
            <div class="rhythm-target"></div>
            <div id="tug-rhythm-cursor" class="rhythm-cursor"></div>
        `;
        document.body.appendChild(hud);

        const status = document.createElement('div');
        status.id = 'tug-game-status';
        status.className = 'tug-status';
        status.textContent = '¡PREPÁRENSE!'; // Changed from ¡JALEN!
        document.body.appendChild(status);

        const countdown = document.createElement('div');
        countdown.id = 'tug-countdown';
        countdown.className = 'tug-countdown';
        document.body.appendChild(countdown);

        const timer = document.createElement('div');
        timer.id = 'tug-timer';
        timer.className = 'tug-timer';
        document.body.appendChild(timer);
    }

    updateGameState(state) {
        if (!state) return;

        // Handle countdown and timer
        const countdownEl = document.getElementById('tug-countdown');
        const timerEl = document.getElementById('tug-timer');
        const statusEl = document.getElementById('tug-game-status');
        
        if (state.gameState === 'countdown') {
            if (countdownEl) {
                countdownEl.style.display = 'block';
                countdownEl.textContent = state.countdown > 0 ? state.countdown : '¡YA!';
            }
            if (timerEl) timerEl.style.display = 'none';
            if (statusEl) statusEl.textContent = '¡PREPÁRENSE!';

            // Animations keep running in the render loop
            return;
        } else if (state.gameState === 'active') {
            if (countdownEl) countdownEl.style.display = 'none';
            if (timerEl) {
                timerEl.style.display = 'block';
                timerEl.textContent = `${state.timeLeft}s`;
                if (state.timeLeft <= 10) {
                    timerEl.classList.add('low-time');
                } else {
                    timerEl.classList.remove('low-time');
                }
            }
            if (statusEl) statusEl.textContent = '¡JALEN!';
        } else {
            if (countdownEl) countdownEl.style.display = 'none';
            if (timerEl) timerEl.style.display = 'none';
        }

        // Rope target position (rope, marker and both teams are moved in animate())
        // Map server -100...100 to world -25...25
        this.markerPos = state.markerPos || 0;
        this.ropeTargetX = (this.markerPos / 100) * 25;

        // Apply player state and sync names if they changed (animations run in animate())
        (state.players || []).forEach(pState => {
            const entity = this.players.get(pState.id);
            if (entity) {
                if (pState.name && entity.name !== pState.name) {
                    entity.setName(pState.name);
                }
                entity.applyState(pState);
            }
        });
    }

    showGameOver(data) {
        let winnerTeamName = 'EMPATE';
        let winners = [];
        
        const resultPlayers = data.players || [];
        if (data.winnerTeam === 'left') {
            winnerTeamName = 'EQUIPO IZQUIERDO';
            winners = resultPlayers.filter(p => p.team === 'left').map(p => escapeHtml(p.name));
        } else if (data.winnerTeam === 'right') {
            winnerTeamName = 'EQUIPO DERECHO';
            winners = resultPlayers.filter(p => p.team === 'right').map(p => escapeHtml(p.name));
        }

        const status = document.getElementById('tug-game-status');
        if (status) {
            let html = `¡FIN DE LA PARTIDA!<br>`;
            if (data.winnerTeam === 'draw') {
                html += `<span style="color: #ffffff">¡EMPATE!</span>`;
            } else {
                html += `<span style="color: ${data.winnerTeam === 'left' ? '#ff3366' : '#00ffcc'}">${winnerTeamName} GANA</span>`;
                if (winners.length > 0) {
                    html += `<br><span style="font-size: 1.2rem; color: white; text-shadow: none;">(${winners.join(', ')})</span>`;
                }
            }
            status.innerHTML = html;
        }

        // Hide HUD elements that are no longer needed
        const rhythmHud = document.querySelector('.rhythm-hud');
        if (rhythmHud) rhythmHud.style.display = 'none';
        const timer = document.getElementById('tug-timer');
        if (timer) timer.style.display = 'none';
        
        // Final animations (kept alive by the render loop; draw = both teams idle).
        // Entities whose model is still loading pick it up on arrival.
        this.finalWinnerTeam = data.winnerTeam === 'left' || data.winnerTeam === 'right' ? data.winnerTeam : 'draw';
        this.players.forEach(entity => entity.setFinalAnim(this.finalAnimFor(entity)));

        this.showRematchPanel();
    }

    // =================================
    // Rematch
    // =================================

    ensureRematchPanel() {
        let panel = document.getElementById('tug-rematch-panel');
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'tug-rematch-panel';
        const btn = document.createElement('button');
        btn.id = 'tug-rematch-btn';
        btn.type = 'button';
        btn.textContent = 'REVANCHA';
        btn.addEventListener('click', () => this.requestRematch());
        const error = document.createElement('div');
        error.id = 'tug-rematch-error';
        panel.appendChild(btn);
        panel.appendChild(error);
        document.body.appendChild(panel);
        return panel;
    }

    setRematchButtonState(pending, errorText) {
        this.rematchPending = pending;
        const btn = document.getElementById('tug-rematch-btn');
        if (btn) {
            btn.disabled = pending;
            btn.textContent = pending ? 'PREPARANDO...' : 'REVANCHA';
        }
        const error = document.getElementById('tug-rematch-error');
        if (error) error.textContent = errorText || '';
    }

    showRematchPanel() {
        this.ensureRematchPanel().classList.add('visible');
        this.setRematchButtonState(false);
    }

    hideRematchPanel() {
        document.getElementById('tug-rematch-panel')?.classList.remove('visible');
        this.setRematchButtonState(false);
    }

    requestRematch() {
        if (this.rematchPending || !this.socket) return;
        this.setRematchButtonState(true);

        // Timeout so the button never stays stuck if the ack is lost
        this.socket.timeout(5000).emit('request-rematch', (err, res) => {
            if (err || !res?.success) {
                const reason = err ? 'Sin respuesta del servidor' : (res?.error || 'No se pudo iniciar la revancha');
                console.warn('[Tug] Rematch failed:', reason);
                this.setRematchButtonState(false, reason);
            }
            // On success the panel stays until 'round-starting' hides it
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        // One shared delta per frame (clamped to avoid jumps after tab switches)
        const delta = Math.min(this.clock.getDelta(), 0.1);

        // Smoothly slide rope, marker and both teams towards the server position
        this.ropeX += (this.ropeTargetX - this.ropeX) * Math.min(1, delta * 10);
        if (this.rope) this.rope.position.x = this.ropeX;
        if (this.marker) this.marker.position.x = this.ropeX;

        this.players.forEach(entity => {
            entity.model.position.x = entity.homeX + this.ropeX;
            entity.tick(delta);
        });

        // Rhythm cursor (purely visual, independent of server ticks)
        const cursor = document.getElementById('tug-rhythm-cursor');
        if (cursor) {
            const pulseInterval = 1500;
            const progress = (Date.now() % pulseInterval) / pulseInterval;
            cursor.style.left = `${progress * 100}%`;
        }

        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}

new TugGame();

