/**
 * Race Game - Sprint Racing Mode
 * Players tap left/right alternately to run faster
 * First to cross the finish line wins!
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SERVER_URL } from '../config.js';
import TournamentManager from '../tournament/TournamentManager.js';

// Race configuration
const RACE_CONFIG = {
    TRACK_LENGTH: 100,      // Distance to finish line
    TRACK_WIDTH: 20,        // Width of the track
    LANE_WIDTH: 2.5,        // Width per lane
    MAX_PLAYERS: 8,
    
    // Movement
    BASE_SPEED: 0,          // No automatic movement
    TAP_BOOST: 0.8,         // Speed boost per valid tap
    MAX_SPEED: 15,          // Maximum speed
    DECELERATION: 0.95,     // Speed decay when not tapping
    
    // Animation
    IDLE_THRESHOLD: 0.5,    // Speed below this = idle animation
    WALK_THRESHOLD: 3,      // Speed below this = walk animation
    
    // Camera
    CAMERA_HEIGHT: 15,
    CAMERA_DISTANCE: 20,
    CAMERA_LERP: 0.05
};

// Character models (same as other modes)
const CHARACTER_MODELS = {
    'baby': { path: 'assets/bebe.fbx', color: '#A2D2FF', name: 'Bebé' },
    'angel': { path: 'assets/Angel.fbx', color: '#00ffcc', name: 'Angel' },
    'edgar': { path: 'assets/Edgar_Model.fbx', color: '#ff6600', name: 'Edgar' },
    'hector': { path: 'assets/Hector.fbx', color: '#9966ff', name: 'Hector' },
    'isabella': { path: 'assets/Isabella_Model.fbx', color: '#ff3366', name: 'Isabella' },
    'jesus': { path: 'assets/Jesus_Model.fbx', color: '#66ff33', name: 'Jesus' },
    'katy': { path: 'assets/Katy.fbx', color: '#ffcc00', name: 'Katy' },
    'lia': { path: 'assets/Lia_Model.fbx', color: '#00ccff', name: 'Lia' },
    'mariana': { path: 'assets/Mariana.fbx', color: '#ff66cc', name: 'Mariana' },
    'sol': { path: 'assets/Sol.fbx', color: '#ffd700', name: 'Sol' },
    'yadira': { path: 'assets/Yadira.fbx', color: '#ff00ff', name: 'Yadira' },
    'lidia': { path: 'assets/Lidia.fbx', color: '#ff8800', name: 'Lidia' },
    'fabian': { path: 'assets/Fabian.fbx', color: '#3399ff', name: 'Fabian' },
    'marile': { path: 'assets/Marile.fbx', color: '#ff99cc', name: 'Marile' },
    'gabriel': { path: 'assets/Gabriel.fbx', color: '#66ccff', name: 'Gabriel' }
};

// Animation files (same as arena)
const ANIMATION_FILES = {
    walk: 'assets/Meshy_AI_Animation_Walking_withSkin.fbx',
    run: 'assets/Meshy_AI_Animation_Running_withSkin.fbx',
    crawling: 'assets/@Crawling.fbx'
};

/**
 * Race Player Entity
 */
class RacePlayerEntity {
    constructor(id, name, color, number, model, animations) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.number = number;
        this.model = model;
        this.animations = animations;
        this.mixer = null;
        this.currentAction = null;
        this.currentAnimation = 'idle';
        
        // Race state
        this.position = 0;        // Distance from start
        this.speed = 0;           // Current speed
        this.lane = 0;            // Lane number (0-7)
        this.lastTap = null;      // 'left' or 'right'
        this.tapCount = 0;        // Total valid taps
        this.finished = false;    // Crossed finish line
        this.finishTime = 0;      // Time when finished
        
        // 3D position
        this.worldPosition = new THREE.Vector3();
        
        // Name label
        this.nameLabel = null;
        
        if (model) {
            this.setupMixer();
            this.createNameLabel();
        }
    }
    
    setupMixer() {
        this.mixer = new THREE.AnimationMixer(this.model);
    }
    
    createNameLabel() {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'race-player-name';
        labelDiv.textContent = this.name;
        labelDiv.style.borderColor = this.color;
        
        this.nameLabel = new CSS2DObject(labelDiv);
        this.nameLabel.position.set(0, 250, 0); // Above the character (model has scale 0.01, so 250 local = 2.5 world)
        this.model.add(this.nameLabel);
    }
    
    playAnimation(name, forceRestart = false) {
        // Map 'idle' to 'walk' with slow speed since we don't have idle animation
        const actualName = name === 'idle' ? 'walk' : name;
        
        if (!this.mixer || !this.animations[actualName]) return;
        
        // Don't restart if already playing the same animation (unless forced)
        if (this.currentAnimation === name && !forceRestart) {
            return; // Already playing this animation, let it loop
        }
        
        const newAction = this.mixer.clipAction(this.animations[actualName]);
        
        // Only transition if it's a different animation
        if (this.currentAction && this.currentAction !== newAction) {
            this.currentAction.fadeOut(0.3);
            newAction.reset();
            newAction.fadeIn(0.3);
        } else if (!this.currentAction) {
            newAction.reset();
        }
        
        // Set loop mode to ensure smooth looping
        newAction.setLoop(THREE.LoopRepeat, Infinity);
        newAction.clampWhenFinished = false;
        newAction.play();
        
        // Adjust speed based on animation
        if (name === 'run') {
            newAction.timeScale = 1.8; // Fast running animation
        } else if (name === 'crawling') {
            newAction.timeScale = 1.5; // Fast crawl
        } else if (name === 'walk') {
            newAction.timeScale = 1.0;
        } else if (name === 'idle') {
            newAction.timeScale = 0.3; // Very slow walk = idle
        }
        
        this.currentAction = newAction;
        this.currentAnimation = name;
    }
    
    update(delta) {
        if (this.mixer) {
            this.mixer.update(delta);
        }
        
        // Determine target animation based on speed and mode
        let targetAnimation;
        const isBabyShower = document.documentElement.classList.contains('baby-theme');

        if (this.speed < RACE_CONFIG.IDLE_THRESHOLD) {
            targetAnimation = 'idle';
        } else if (this.speed < RACE_CONFIG.WALK_THRESHOLD) {
            // Add hysteresis: if currently running, stay running until speed drops more
            const runAnim = isBabyShower ? 'crawling' : 'run';
            if (this.currentAnimation === runAnim && this.speed > RACE_CONFIG.WALK_THRESHOLD * 0.7) {
                targetAnimation = runAnim;
            } else {
                targetAnimation = 'walk';
            }
        } else {
            targetAnimation = isBabyShower ? 'crawling' : 'run';
        }
        
        // Only change animation if target is different
        if (targetAnimation !== this.currentAnimation) {
            this.playAnimation(targetAnimation);
        }
    }
    
    dispose() {
        if (this.nameLabel && this.nameLabel.element) {
            this.nameLabel.element.remove();
        }
    }
}

/**
 * Main Race Game Class
 */
class RaceGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        
        this.players = new Map();
        this.localPlayerId = null;
        this.isHost = false;
        
        this.socket = null;
        this.roomCode = null;
        
        this.gameState = 'lobby'; // 'lobby', 'countdown', 'racing', 'finished'
        this.raceStartTime = 0;
        
        // Audio managers
        this.bgmManager = window.BGMManager ? new window.BGMManager() : null;
        this.sfxManager = window.SFXManager ? new window.SFXManager() : null;
        
        this.loadedModels = {}; // Cache for loaded character models
        this.animations = {};
        this.fbxLoader = null;
        
        this.clock = new THREE.Clock();
        
        // Camera mode: 'dynamic', 'top', 'side'
        this.cameraMode = 'dynamic';
        
        this.init();
    }
    
    async init() {
        // Apply baby theme if needed
        if (window.location.search.includes('mode=baby_shower')) {
            document.documentElement.classList.add('baby-theme');
        }

        this.setupRenderer();
        this.setupScene();
        this.setupCamera();
        this.setupLights();
        this.createTrack();
        
        await this.loadAssets();
        
        this.setupSocket();
        this.setupScoreboard();
        this.createCameraSelector();
        
        this.hideLoading();
        this.animate();
    }
    
    setupRenderer() {
        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas, 
            antialias: true,
            alpha: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Label renderer for floating names
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.getElementById('game-container').appendChild(this.labelRenderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize());
    }
    
    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);
        this.scene.fog = new THREE.Fog(0x1a1a2e, 50, 150);
    }
    
    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            500
        );
        this.camera.position.set(0, RACE_CONFIG.CAMERA_HEIGHT, -RACE_CONFIG.CAMERA_DISTANCE);
        this.camera.lookAt(0, 0, 0);
    }
    
    setupLights() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        
        // Main directional light
        const sun = new THREE.DirectionalLight(0xffffff, 1);
        sun.position.set(50, 100, 50);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 200;
        sun.shadow.camera.left = -60;
        sun.shadow.camera.right = 60;
        sun.shadow.camera.top = 60;
        sun.shadow.camera.bottom = -60;
        this.scene.add(sun);
        
        // Colored accent lights along track
        const colors = [0x00ff88, 0x00ccff, 0xff6600, 0xff3366];
        for (let i = 0; i < 4; i++) {
            const light = new THREE.PointLight(colors[i], 0.5, 30);
            light.position.set(
                (i % 2 === 0 ? -1 : 1) * 12,
                5,
                i * 25
            );
            this.scene.add(light);
        }
    }
    
    createTrack() {
        // Ground plane
        const groundGeo = new THREE.PlaneGeometry(50, RACE_CONFIG.TRACK_LENGTH + 40);
        const groundMat = new THREE.MeshStandardMaterial({ 
            color: 0x2d2d44,
            roughness: 0.8
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.z = RACE_CONFIG.TRACK_LENGTH / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        
        // Track surface
        const trackGeo = new THREE.PlaneGeometry(
            RACE_CONFIG.TRACK_WIDTH,
            RACE_CONFIG.TRACK_LENGTH
        );
        const trackMat = new THREE.MeshStandardMaterial({ 
            color: 0x3d3d5c,
            roughness: 0.6
        });
        const track = new THREE.Mesh(trackGeo, trackMat);
        track.rotation.x = -Math.PI / 2;
        track.position.y = 0.01;
        track.position.z = RACE_CONFIG.TRACK_LENGTH / 2;
        track.receiveShadow = true;
        this.scene.add(track);
        
        // Lane lines
        this.createLaneLines();
        
        // Start line
        this.createStartLine();
        
        // Finish line
        this.createFinishLine();
        
        // Decorative elements
        this.createTrackDecorations();
    }
    
    createLaneLines() {
        const lineMaterial = new THREE.MeshBasicMaterial({ color: 0x666688 });
        
        for (let i = 0; i <= RACE_CONFIG.MAX_PLAYERS; i++) {
            const x = (i - RACE_CONFIG.MAX_PLAYERS / 2) * RACE_CONFIG.LANE_WIDTH;
            
            // Dashed line effect using segments
            for (let z = 0; z < RACE_CONFIG.TRACK_LENGTH; z += 4) {
                const lineGeo = new THREE.BoxGeometry(0.1, 0.02, 2);
                const line = new THREE.Mesh(lineGeo, lineMaterial);
                line.position.set(x, 0.02, z + 1);
                this.scene.add(line);
            }
        }
    }
    
    createStartLine() {
        // Start line
        const startGeo = new THREE.BoxGeometry(RACE_CONFIG.TRACK_WIDTH + 2, 0.05, 1);
        const startMat = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
        const startLine = new THREE.Mesh(startGeo, startMat);
        startLine.position.set(0, 0.03, 0);
        this.scene.add(startLine);
        
        // Start gate (arch)
        this.createGate(0, 0x00ff88, '🏁 START');
    }
    
    createFinishLine() {
        // Checkered finish line
        const checkerSize = 1;
        const numCheckers = Math.floor(RACE_CONFIG.TRACK_WIDTH / checkerSize);
        
        for (let x = 0; x < numCheckers; x++) {
            for (let z = 0; z < 2; z++) {
                const isWhite = (x + z) % 2 === 0;
                const checkerGeo = new THREE.BoxGeometry(checkerSize, 0.05, checkerSize);
                const checkerMat = new THREE.MeshStandardMaterial({ 
                    color: isWhite ? 0xffffff : 0x000000 
                });
                const checker = new THREE.Mesh(checkerGeo, checkerMat);
                checker.position.set(
                    (x - numCheckers / 2 + 0.5) * checkerSize,
                    0.03,
                    RACE_CONFIG.TRACK_LENGTH + z * checkerSize
                );
                this.scene.add(checker);
            }
        }
        
        // Finish gate
        this.createGate(RACE_CONFIG.TRACK_LENGTH, 0xffd700, '🏆 FINISH');
    }
    
    createGate(z, color, text) {
        // Left pillar
        const pillarGeo = new THREE.CylinderGeometry(0.3, 0.4, 6, 8);
        const pillarMat = new THREE.MeshStandardMaterial({ 
            color: color,
            emissive: color,
            emissiveIntensity: 0.3
        });
        
        const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
        leftPillar.position.set(-RACE_CONFIG.TRACK_WIDTH / 2 - 1, 3, z);
        this.scene.add(leftPillar);
        
        const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
        rightPillar.position.set(RACE_CONFIG.TRACK_WIDTH / 2 + 1, 3, z);
        this.scene.add(rightPillar);
        
        // Top bar
        const barGeo = new THREE.BoxGeometry(RACE_CONFIG.TRACK_WIDTH + 3, 0.5, 0.5);
        const bar = new THREE.Mesh(barGeo, pillarMat);
        bar.position.set(0, 6, z);
        this.scene.add(bar);
    }
    
    createTrackDecorations() {
        // Geometric shapes along the sides
        const shapes = [
            { geo: new THREE.OctahedronGeometry(1.5), color: 0x00ff88 },
            { geo: new THREE.TetrahedronGeometry(1.5), color: 0xff6600 },
            { geo: new THREE.IcosahedronGeometry(1.2), color: 0x00ccff },
            { geo: new THREE.DodecahedronGeometry(1.3), color: 0xff3366 }
        ];
        
        for (let z = 10; z < RACE_CONFIG.TRACK_LENGTH; z += 15) {
            const shapeIndex = Math.floor(z / 15) % shapes.length;
            const shape = shapes[shapeIndex];
            
            // Left side
            const leftMat = new THREE.MeshStandardMaterial({
                color: shape.color,
                emissive: shape.color,
                emissiveIntensity: 0.2,
                wireframe: Math.random() > 0.5
            });
            const leftShape = new THREE.Mesh(shape.geo.clone(), leftMat);
            leftShape.position.set(-RACE_CONFIG.TRACK_WIDTH / 2 - 5, 2, z);
            leftShape.rotation.set(Math.random(), Math.random(), Math.random());
            this.scene.add(leftShape);
            
            // Right side
            const rightMat = leftMat.clone();
            const rightShape = new THREE.Mesh(shape.geo.clone(), rightMat);
            rightShape.position.set(RACE_CONFIG.TRACK_WIDTH / 2 + 5, 2, z);
            rightShape.rotation.set(Math.random(), Math.random(), Math.random());
            this.scene.add(rightShape);
            
            // Animate them
            this.animateDecoration(leftShape);
            this.animateDecoration(rightShape);
        }
    }
    
    animateDecoration(mesh) {
        const speed = 0.5 + Math.random() * 0.5;
        const update = () => {
            mesh.rotation.x += 0.01 * speed;
            mesh.rotation.y += 0.015 * speed;
            requestAnimationFrame(update);
        };
        update();
    }
    
    async loadAssets() {
        this.fbxLoader = new FBXLoader();
        const progressFill = document.getElementById('progress-fill');
        const loadingText = document.getElementById('loading-text');
        
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        
        try {
            // Load only needed character models
            const characterKeys = isBabyShower ? ['baby'] : Object.keys(CHARACTER_MODELS);
            const totalItems = characterKeys.length + Object.keys(ANIMATION_FILES).length;
            let loadedItems = 0;
            
            for (const key of characterKeys) {
                const charInfo = CHARACTER_MODELS[key];
                if (!charInfo) continue;

                loadingText.textContent = `Cargando ${charInfo.name}...`;
                
                try {
                    this.loadedModels[key] = await this.fbxLoader.loadAsync(charInfo.path);
                    console.log(`[Race] Loaded model: ${key}`);
                } catch (err) {
                    console.warn(`[Race] Failed to load model ${key}:`, err);
                }
                
                loadedItems++;
                progressFill.style.width = `${(loadedItems / totalItems) * 100}%`;
            }
            
            // Load animations
            loadingText.textContent = 'Cargando animaciones...';
            
            for (const [name, path] of Object.entries(ANIMATION_FILES)) {
                const anim = await this.fbxLoader.loadAsync(path);
                if (anim.animations && anim.animations.length > 0) {
                    this.animations[name] = anim.animations[0];
                }
                loadedItems++;
                progressFill.style.width = `${(loadedItems / totalItems) * 100}%`;
            }
            
            progressFill.style.width = '100%';
            loadingText.textContent = '¡Listo!';
            
        } catch (error) {
            console.error('Error loading assets:', error);
            loadingText.textContent = 'Error cargando recursos';
        }
    }
    
    setupSocket() {
        console.log('[Race] Connecting to server:', SERVER_URL);
        
        this.socket = io(SERVER_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 5
        });
        
        this.socket.on('connect', () => {
            console.log('[Race] Connected to server');
            this.createRoom();
        });
        
        this.socket.on('disconnect', () => {
            console.log('[Race] Disconnected from server');
            this.updateAnimationDisplay('Desconectado del servidor');
        });
        
        // Game events
        this.socket.on('player-joined', (data) => {
            console.log('[Race] Player joined:', data);
            this.addPlayer(data.player);
            this.updateRoomOverlay(data.room?.playerCount || this.players.size);
        });
        
        this.socket.on('player-left', (data) => {
            console.log('[Race] Player left:', data);
            this.removePlayer(data.playerId);
            this.updateRoomOverlay(this.players.size);
        });
        
        this.socket.on('game-started', (data) => {
            console.log('[Race] Game started!', data);
            
            // Clear existing players and add all from server
            this.players.forEach((player, id) => {
                if (player.model && player.model.parent) {
                    player.model.parent.remove(player.model);
                }
                player.dispose();
            });
            this.players.clear();
            
            // Add all players with their correct characters
            if (data.players) {
                data.players.forEach((playerData, index) => {
                    this.addPlayer({
                        ...playerData,
                        lane: index
                    });
                });
            }
            
            // Hide room code overlay
            document.getElementById('room-code-overlay')?.classList.add('hidden');
        });
        
        // Race-specific events
        this.socket.on('race-state', (state) => {
            this.handleRaceState(state);
        });
        
        this.socket.on('race-countdown', (data) => {
            this.showCountdown(data.count);
        });
        
        this.socket.on('race-start', () => {
            this.startRace();
        });
        
        this.socket.on('race-finish', (data) => {
            this.handleRaceFinish(data);
        });
        
        this.socket.on('race-winner', (data) => {
            this.showWinner(data);
        });
        
        // Tournament events - listen for round transitions
        this.socket.on('round-starting', (data) => {
            console.log('[Race] Round starting:', data);
            this.resetForNextRound(data);
        });
        
        this.socket.on('round-ended', (data) => {
            console.log('[Race] Round ended:', data);
            // Hide winner overlay since tournament overlay will show
            const winnerOverlay = document.getElementById('winner-overlay');
            if (winnerOverlay) {
                winnerOverlay.classList.add('hidden');
            }
        });
        
        this.socket.on('tournament-ended', (data) => {
            console.log('[Race] Tournament ended:', data);
            // Hide winner overlay since tournament end overlay will show
            const winnerOverlay = document.getElementById('winner-overlay');
            if (winnerOverlay) {
                winnerOverlay.classList.add('hidden');
            }
        });
        
        // Initialize tournament manager
        this.tournamentManager = new TournamentManager(this.socket, 'race');
    }
    
    createRoom() {
        // Get character from URL or random
        const urlParams = new URLSearchParams(window.location.search);
        const characterKeys = Object.keys(CHARACTER_MODELS);
        const character = (urlParams.get('character') || 
            characterKeys[Math.floor(Math.random() * characterKeys.length)]).toLowerCase();
        
        this.selectedCharacter = character;
        
        // Use callback like Arena does
        this.socket.emit('create-room', { 
            gameMode: 'race',
            character: character
        }, (response) => {
            console.log('[Race] create-room response:', response);
            if (response && response.success) {
                this.roomCode = response.roomCode;
                this.isHost = true;
                console.log(`[Race] Room created: ${this.roomCode}`);
                this.updateAnimationDisplay(`Sala: ${this.roomCode} - Esperando corredores...`);
                this.showRoomCode(this.roomCode);
            } else {
                console.error('[Race] Failed to create room:', response);
                this.updateAnimationDisplay('Error al crear sala');
            }
        });
    }
    
    updateAnimationDisplay(text) {
        const el = document.getElementById('animation-name');
        if (el) el.textContent = text;
    }
    
    showRoomCode(code) {
        let overlay = document.getElementById('room-code-overlay');
        const mobileUrl = `${window.location.origin}/mobile/?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(mobileUrl)}`;
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'room-code-overlay';
            overlay.innerHTML = `
                <div class="room-code-content">
                    <h2>🏁 CARRERA DE PELUCHES</h2>
                    <div class="room-code">${code}</div>
                    <div class="qr-container">
                        <img src="${qrCodeUrl}" alt="QR Code" class="qr-code" />
                    </div>
                    <p>Escanea o ingresa este código en tu celular</p>
                    <a href="${mobileUrl}" target="_blank" class="url">${mobileUrl}</a>
                    
                    <div class="rounds-selector">
                        <span class="rounds-label">RONDAS:</span>
                        <button class="round-btn selected" data-rounds="1">1</button>
                        <button class="round-btn" data-rounds="3">3</button>
                        <button class="round-btn" data-rounds="5">5</button>
                    </div>
                    
                    <button id="start-race-btn" disabled>INICIAR CARRERA</button>
                    <p class="waiting-text">Esperando corredores...</p>
                </div>
            `;
            
            const style = document.createElement('style');
            style.textContent = `
                #room-code-overlay {
                    position: fixed; top: 20px; right: 20px;
                    background: rgba(10, 10, 21, 0.95);
                    border: 2px solid #00ff88; border-radius: 16px;
                    padding: 24px; z-index: 100; text-align: center;
                    font-family: 'Orbitron', sans-serif;
                    box-shadow: 0 0 30px rgba(0, 255, 136, 0.3);
                    min-width: 280px;
                }
                #room-code-overlay h2 { color: #00ff88; font-size: 1rem; margin-bottom: 12px; }
                #room-code-overlay .room-code {
                    font-size: 3rem; font-weight: 900; color: #ffcc00;
                    letter-spacing: 12px; text-shadow: 0 0 20px rgba(255, 204, 0, 0.5);
                    margin-bottom: 12px;
                }
                #room-code-overlay .qr-container {
                    margin: 16px auto; padding: 10px; background: #0a0a15;
                    border-radius: 12px; border: 2px solid #00ff88; display: inline-block;
                }
                #room-code-overlay .qr-code { display: block; width: 120px; height: 120px; }
                #room-code-overlay p { color: rgba(255,255,255,0.7); font-size: 0.85rem; }
                #room-code-overlay .url { color: #ff3366; font-size: 0.75rem; text-decoration: none; }
                #room-code-overlay button {
                    margin-top: 16px; padding: 14px 28px;
                    font-family: 'Orbitron', sans-serif; font-size: 1rem;
                    background: linear-gradient(135deg, #00ff88, #00ccff);
                    border: none; border-radius: 8px; color: #0a0a15; cursor: pointer;
                }
                #room-code-overlay button:disabled { opacity: 0.5; cursor: not-allowed; }
                #room-code-overlay.hidden { display: none; }
            `;
            document.head.appendChild(style);
            document.body.appendChild(overlay);
            
            document.getElementById('start-race-btn').addEventListener('click', () => {
                this.startGame();
            });
            
            // Add rounds selector listeners
            this.setupRoundsSelector();
        }
    }
    
    setupRoundsSelector() {
        const roundBtns = document.querySelectorAll('.round-btn');
        roundBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rounds = parseInt(e.target.dataset.rounds);
                
                // Update UI
                roundBtns.forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
                
                // Send to server
                this.tournamentRounds = rounds;
                this.socket?.emit('set-tournament-rounds', rounds);
            });
        });
    }
    
    startGame() {
        if (!this.socket || !this.isHost) return;
        
        console.log('[Race] Starting game...');
        
        this.socket.emit('start-game', (response) => {
            console.log('[Race] start-game response:', response);
            if (response && response.success) {
                this.gameState = 'countdown';
                document.getElementById('room-code-overlay')?.classList.add('hidden');
                this.updateAnimationDisplay('¡Preparándose para la carrera!');
            } else {
                console.error('[Race] Failed to start game:', response);
                this.updateAnimationDisplay('Error al iniciar: ' + (response?.error || 'desconocido'));
            }
        });
    }
    
    updateRoomOverlay(playerCount) {
        const btn = document.getElementById('start-race-btn');
        const text = document.querySelector('#room-code-overlay .waiting-text');
        
        if (btn && text) {
            btn.disabled = playerCount < 1;
            text.textContent = playerCount > 0 
                ? `${playerCount} corredor${playerCount > 1 ? 'es' : ''} listo${playerCount > 1 ? 's' : ''}`
                : 'Esperando corredores...';
        }
    }
    
    async addPlayer(playerData) {
        if (this.players.has(playerData.id)) return;
        
        const characterKey = (playerData.character || 'angel').toLowerCase();
        const characterInfo = CHARACTER_MODELS[characterKey] || CHARACTER_MODELS['angel'];
        
        // Get the correct model for this character
        let sourceModel = this.loadedModels[characterKey];
        
        // Fallback to first available model if character not found
        if (!sourceModel) {
            console.warn(`[Race] Model not found for ${characterKey}, using fallback`);
            const fallbackKey = Object.keys(this.loadedModels)[0];
            sourceModel = this.loadedModels[fallbackKey];
        }
        
        if (!sourceModel) {
            console.error('[Race] No models loaded!');
            return;
        }
        
        // Clone the correct character model
        const model = SkeletonUtils.clone(sourceModel);
        model.scale.set(0.01, 0.01, 0.01);
        
        console.log(`[Race] Creating player with character: ${characterKey}`);
        
        // Create player entity
        const player = new RacePlayerEntity(
            playerData.id,
            playerData.name || characterInfo.name,
            characterInfo.color,
            playerData.number || this.players.size + 1,
            model,
            this.animations
        );
        
        // Set initial position (lane based)
        player.lane = this.players.size;
        const laneX = (player.lane - RACE_CONFIG.MAX_PLAYERS / 2 + 0.5) * RACE_CONFIG.LANE_WIDTH;
        model.position.set(laneX, 0, 0);
        model.rotation.y = 0; // Face forward (toward finish)
        
        player.worldPosition.set(laneX, 0, 0);
        
        // Enable shadows and fix transparency
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                
                // Fix transparency - make character fully opaque
                if (child.material) {
                    if (!Array.isArray(child.material)) {
                        child.material = child.material.clone();
                    }
                    
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        mat.transparent = false;
                        mat.opacity = 1.0;
                        mat.depthWrite = true;
                        mat.depthTest = true;
                    });
                }
            }
        });
        
        this.scene.add(model);
        this.players.set(playerData.id, player);
        
        // Start idle animation
        player.playAnimation('idle');
        
        // Update scoreboard
        this.updateScoreboard();
        
        // Update progress markers
        this.updateProgressMarkers();
        
        console.log(`[Race] Added player ${player.name} in lane ${player.lane}`);
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            if (player.model && player.model.parent) {
                player.model.parent.remove(player.model);
            }
            player.dispose();
            this.players.delete(playerId);
            this.updateScoreboard();
            this.updateProgressMarkers();
        }
    }
    
    setupScoreboard() {
        // Scoreboard is already in HTML, just need to populate it
        this.updateScoreboard();
    }
    
    createCameraSelector() {
        // Create camera selector UI
        const selector = document.createElement('div');
        selector.id = 'camera-selector';
        selector.innerHTML = `
            <div class="camera-label">📷 CÁMARA</div>
            <div class="camera-buttons">
                <button class="camera-btn active" data-mode="dynamic" title="Cámara Dinámica">
                    <span class="cam-icon">🎬</span>
                    <span class="cam-text">Dinámica</span>
                </button>
                <button class="camera-btn" data-mode="top" title="Vista Aérea">
                    <span class="cam-icon">🔽</span>
                    <span class="cam-text">Arriba</span>
                </button>
                <button class="camera-btn" data-mode="side" title="Vista Lateral">
                    <span class="cam-icon">➡️</span>
                    <span class="cam-text">Lateral</span>
                </button>
            </div>
        `;
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #camera-selector {
                position: fixed;
                bottom: 100px;
                right: 20px;
                background: rgba(10, 10, 21, 0.9);
                border: 2px solid #00ff88;
                border-radius: 12px;
                padding: 12px;
                z-index: 50;
                font-family: 'Orbitron', sans-serif;
            }
            .camera-label {
                color: #00ff88;
                font-size: 0.75rem;
                text-align: center;
                margin-bottom: 8px;
                letter-spacing: 2px;
            }
            .camera-buttons {
                display: flex;
                gap: 6px;
            }
            .camera-btn {
                background: rgba(0, 255, 136, 0.1);
                border: 1px solid rgba(0, 255, 136, 0.3);
                border-radius: 8px;
                padding: 8px 12px;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
            }
            .camera-btn:hover {
                background: rgba(0, 255, 136, 0.2);
                border-color: #00ff88;
                transform: scale(1.05);
            }
            .camera-btn.active {
                background: linear-gradient(135deg, rgba(0, 255, 136, 0.3), rgba(0, 204, 255, 0.3));
                border-color: #00ff88;
                box-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
            }
            .cam-icon {
                font-size: 1.2rem;
            }
            .cam-text {
                color: #fff;
                font-size: 0.65rem;
                letter-spacing: 1px;
            }
            .camera-btn.active .cam-text {
                color: #00ff88;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(selector);
        
        // Add event listeners
        selector.querySelectorAll('.camera-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                selector.querySelectorAll('.camera-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Change camera mode
                this.cameraMode = btn.dataset.mode;
                console.log('[Race] Camera mode changed to:', this.cameraMode);
            });
        });
    }
    
    updateScoreboard() {
        const container = document.getElementById('race-positions');
        if (!container) return;
        
        // Sort players by position (progress toward finish)
        const sortedPlayers = Array.from(this.players.values())
            .sort((a, b) => b.position - a.position);
        
        container.innerHTML = sortedPlayers.map((player, index) => {
            const positionClass = index === 0 ? 'first' : index === 1 ? 'second' : index === 2 ? 'third' : 'other';
            const progress = Math.floor((player.position / RACE_CONFIG.TRACK_LENGTH) * 100);
            
            return `
                <div class="race-position-item" data-player-id="${player.id}">
                    <div class="position-number ${positionClass}">${index + 1}°</div>
                    <div class="position-badge" style="background: ${player.color}">P${player.number}</div>
                    <div class="position-name">${player.name}</div>
                    <div class="position-progress">${progress}%</div>
                </div>
            `;
        }).join('');
    }
    
    updateProgressMarkers() {
        const container = document.getElementById('progress-markers');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.players.forEach(player => {
            const marker = document.createElement('div');
            marker.className = 'player-marker';
            marker.style.backgroundColor = player.color;
            marker.style.left = `${(player.position / RACE_CONFIG.TRACK_LENGTH) * 100}%`;
            container.appendChild(marker);
        });
    }
    
    showCountdown(count) {
        const overlay = document.getElementById('countdown-overlay');
        const numberEl = document.getElementById('countdown-number');
        
        if (overlay && numberEl) {
            overlay.classList.remove('hidden');
            
            if (count > 0) {
                numberEl.textContent = count;
                numberEl.classList.remove('go');
            } else {
                numberEl.textContent = '¡GO!';
                numberEl.classList.add('go');
                
                setTimeout(() => {
                    overlay.classList.add('hidden');
                }, 500);
            }
            
            // Re-trigger animation
            numberEl.style.animation = 'none';
            numberEl.offsetHeight; // Trigger reflow
            numberEl.style.animation = 'countdownPulse 1s ease-in-out';
        }
        
        // Hide room code overlay
        const roomOverlay = document.getElementById('room-code-overlay');
        if (roomOverlay) roomOverlay.classList.add('hidden');
    }
    
    startRace() {
        console.log('[Race] Race started!');
        this.gameState = 'racing';
        this.raceStartTime = Date.now();
        
        document.getElementById('animation-name').textContent = '¡CARRERA EN CURSO!';
        
        // Start battle BGM
        if (this.bgmManager) {
            this.bgmManager.playBattle();
        }
    }
    
    handleRaceState(state) {
        if (!state || !state.players) return;
        
        state.players.forEach(playerState => {
            const player = this.players.get(playerState.id);
            if (player) {
                player.position = playerState.position;
                player.speed = playerState.speed;
                player.finished = playerState.finished;
                
                // Update 3D position
                const laneX = (player.lane - RACE_CONFIG.MAX_PLAYERS / 2 + 0.5) * RACE_CONFIG.LANE_WIDTH;
                player.model.position.z = player.position;
                player.model.position.x = laneX;
                player.worldPosition.set(laneX, 0, player.position);
            }
        });
        
        // Update UI
        this.updateScoreboard();
        this.updateProgressMarkers();
    }
    
    handleRaceFinish(data) {
        const player = this.players.get(data.playerId);
        if (player) {
            player.finished = true;
            player.finishTime = data.time;
            console.log(`[Race] ${player.name} finished in ${data.time}ms!`);
            
            // Play SFX when player finishes
            if (this.sfxManager) {
                this.sfxManager.playKO(); // Use KO sound as finish sound
            }
        }
    }
    
    showWinner(data) {
        this.gameState = 'finished';
        
        // Play victory music
        if (this.bgmManager) {
            this.bgmManager.playVictory();
        }
        
        const overlay = document.createElement('div');
        overlay.id = 'race-winner-overlay';
        overlay.innerHTML = `
            <div class="winner-content">
                <div class="winner-trophy">🏆</div>
                <div class="winner-title">¡GANADOR!</div>
                <div class="winner-name">${data.winnerName || 'Jugador'}</div>
                <div class="winner-time">Tiempo: ${(data.winnerTime / 1000).toFixed(2)}s</div>
                <div class="final-positions">
                    ${data.positions.map((p, i) => `
                        <div style="color: ${i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#888'}">
                            ${i + 1}° ${p.name || 'Jugador'} - ${p.time ? (p.time / 1000).toFixed(2) + 's' : 'DNF'}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        document.getElementById('animation-name').textContent = `¡${data.winnerName || 'Jugador'} GANA!`;
    }
    
    /**
     * Reset game state for the next round in a tournament
     */
    resetForNextRound(data) {
        console.log('[Race] Resetting for next round:', data.round);
        
        // Hide overlays
        const winnerOverlay = document.getElementById('race-winner-overlay');
        const roundEndOverlay = document.getElementById('round-end-overlay');
        const roomOverlay = document.getElementById('room-code-overlay');
        
        if (winnerOverlay) winnerOverlay.remove();
        if (roundEndOverlay) roundEndOverlay.classList.add('hidden');
        if (roomOverlay) roomOverlay.classList.add('hidden');
        
        // Reset game state
        this.gameState = 'countdown';
        this.raceStartTime = null;
        
        // Reset track elements
        this.currentTrackPosition = 0;
        
        // Reset all players
        let laneIndex = 0;
        this.players.forEach((player, playerId) => {
            // Reset player state
            player.finished = false;
            player.finishTime = null;
            player.progress = 0;
            player.speed = 0;
            player.lane = laneIndex;
            
            // Reset position to start
            const laneOffset = (laneIndex - (this.players.size - 1) / 2) * 3;
            player.worldPosition.set(laneOffset, 0, 0);
            player.model.position.copy(player.worldPosition);
            player.model.visible = true;
            
            if (player.nameLabel) {
                player.nameLabel.element.style.display = 'block';
            }
            
            player.playAnimation('idle');
            laneIndex++;
        });
        
        // Reset camera
        this.camera.position.set(0, 20, -30);
        this.camera.lookAt(0, 0, 30);
        
        // Update HUD
        document.getElementById('animation-name').textContent = `¡RONDA ${data.round}!`;
        
        console.log('[Race] Reset complete');
    }
    
    updateCamera() {
        if (this.players.size === 0) return;
        
        // Find bounds of all players
        let minZ = Infinity, maxZ = -Infinity;
        let minX = Infinity, maxX = -Infinity;
        let avgX = 0, avgZ = 0;
        let count = 0;
        
        this.players.forEach(player => {
            if (!player.finished) {
                avgX += player.worldPosition.x;
                avgZ += player.worldPosition.z;
                minZ = Math.min(minZ, player.worldPosition.z);
                maxZ = Math.max(maxZ, player.worldPosition.z);
                minX = Math.min(minX, player.worldPosition.x);
                maxX = Math.max(maxX, player.worldPosition.x);
                count++;
            }
        });
        
        if (count === 0) {
            // All finished, focus on finish line
            avgZ = RACE_CONFIG.TRACK_LENGTH;
            avgX = 0;
        } else {
            avgX /= count;
            avgZ /= count;
        }
        
        // Calculate spread
        const spreadZ = Math.max(maxZ - minZ, 10);
        const spreadX = Math.max(maxX - minX, 5);
        
        let targetX, targetY, targetCamZ;
        let lookAtX, lookAtY, lookAtZ;
        
        switch (this.cameraMode) {
            case 'top':
                // Top-down camera (bird's eye view)
                const topHeight = Math.max(40, spreadZ * 0.6);
                targetX = avgX;
                targetY = topHeight;
                targetCamZ = avgZ;
                lookAtX = avgX;
                lookAtY = 0;
                lookAtZ = avgZ;
                break;
                
            case 'side':
                // Side camera (lateral view)
                const sideDistance = Math.max(30, spreadZ * 0.5);
                const sideHeight = Math.max(8, spreadZ * 0.15);
                targetX = -sideDistance; // Camera on the left side
                targetY = sideHeight;
                targetCamZ = avgZ;
                lookAtX = 0;
                lookAtY = 1;
                lookAtZ = avgZ;
                break;
                
            case 'dynamic':
            default:
                // Dynamic camera (original - diagonal behind)
                const targetDistance = Math.max(RACE_CONFIG.CAMERA_DISTANCE, spreadZ * 0.8);
                const targetHeight = Math.max(RACE_CONFIG.CAMERA_HEIGHT, spreadZ * 0.4);
                targetX = 0;
                targetY = targetHeight;
                targetCamZ = avgZ - targetDistance;
                lookAtX = avgX;
                lookAtY = 1;
                lookAtZ = avgZ;
                break;
        }
        
        // Smooth interpolation
        const lerpSpeed = RACE_CONFIG.CAMERA_LERP;
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, lerpSpeed);
        this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, lerpSpeed);
        this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetCamZ, lerpSpeed);
        
        // Look at target position
        this.camera.lookAt(lookAtX, lookAtY, lookAtZ);
    }
    
    hideLoading() {
        const loading = document.getElementById('loading-screen');
        if (loading) {
            loading.style.opacity = '0';
            setTimeout(() => loading.style.display = 'none', 500);
        }
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
        
        // Update all players
        this.players.forEach(player => {
            player.update(delta);
        });
        
        // Update camera
        this.updateCamera();
        
        // Render
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}

// Initialize game
const game = new RaceGame();

