/**
 * PINTA EL PISO - Territory Game Mode
 * Three.js based territory game where players paint the floor
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController } from '../animation/AnimationController.js';
import PaintHUD from './PaintHUD.js';

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
        
        this.baseModels = {};
        this.baseAnimations = {};
        
        this.init();
    }

    async init() {
        // Apply baby theme if needed
        if (window.location.search.includes('mode=baby_shower')) {
            document.documentElement.classList.add('baby-theme');
            const gameTitle = document.querySelector('.game-title');
            if (gameTitle) gameTitle.innerHTML = 'PINTA EL CUARTO';
            document.title = 'Pinta el Cuarto - Baby Shower';
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050510);
        
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
        
        await this.loadAssets();
        this.connectToServer();
        
        window.addEventListener('resize', () => this.onWindowResize());
        this.animate();
    }

    setupLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        
        const sun = new THREE.DirectionalLight(0xffffff, 1);
        sun.position.set(5, 15, 5);
        sun.castShadow = true;
        this.scene.add(sun);
    }

    createFloor() {
        // Create dynamic texture for the floor
        this.gridCanvas = document.createElement('canvas');
        this.gridCanvas.width = PAINT_CONFIG.GRID_SIZE;
        this.gridCanvas.height = PAINT_CONFIG.GRID_SIZE;
        this.gridCtx = this.gridCanvas.getContext('2d');
        
        // Initial state
        this.gridCtx.fillStyle = '#1a1a2e';
        this.gridCtx.fillRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
        
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
        const gridHelper = new THREE.GridHelper(PAINT_CONFIG.WORLD_SIZE, PAINT_CONFIG.GRID_SIZE, 0x444444, 0x222222);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);
    }

    async loadAssets() {
        const loader = new FBXLoader();
        
        const isBabyShower = document.documentElement.classList.contains('baby-theme');

        // Load only needed character models
        const charactersToLoad = isBabyShower ? [['baby', CHARACTER_MODELS['baby']]] : Object.entries(CHARACTER_MODELS);
        
        const modelPromises = charactersToLoad.map(async ([id, data]) => {
            try {
                const model = await loader.loadAsync(`assets/${data.file}`);
                this.baseModels[id] = model;
            } catch (e) {
                console.warn(`Failed to load model ${id}:`, e);
            }
        });
        
        await Promise.all(modelPromises);
        
        // Load animations
        const animFiles = {
            walk: 'assets/Meshy_AI_Animation_Walking_withSkin.fbx',
            run: 'assets/Meshy_AI_Animation_Running_withSkin.fbx'
        };

        for (const [name, path] of Object.entries(animFiles)) {
            const anim = await loader.loadAsync(path);
            this.baseAnimations[name] = anim.animations[0];
        }

        document.getElementById('loading-screen').classList.add('hidden');
    }

    connectToServer() {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => {
            this.socket = io(SERVER_URL, {
                transports: ['websocket'],
                reconnection: true
            });
            
            this.socket.on('connect', () => {
                console.log('Connected to server');
                
                const urlParams = new URLSearchParams(window.location.search);
                this.roomCode = urlParams.get('room');
                const isHost = urlParams.get('host') === 'true' || !this.roomCode;

                if (isHost && !this.roomCode) {
                    // Create a new room if none provided
                    const isBabyShower = document.documentElement.classList.contains('baby-theme');
                    this.socket.emit('create-room', { 
                        gameMode: 'paint',
                        isBabyShower: isBabyShower
                    }, (response) => {
                        if (response && response.success) {
                            this.roomCode = response.roomCode;
                            console.log('Created room:', this.roomCode);
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
            });

            this.socket.on('game-started', () => {
                console.log('[Paint] Game started signal received');
                const overlay = document.getElementById('room-code-overlay');
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.style.display = 'none';
                }
            });

            this.socket.on('player-joined', (data) => {
                console.log('Player joined:', data);
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

            this.socket.on('player-left', (data) => {
                console.log('Player left:', data);
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
                this.hud.showResults(data.paintResults, { name: data.roundWinner });
                this.hud.showNextRoundCountdown(5);
            });

            this.socket.on('tournament-ended', (data) => {
                this.hud.showResults(data.paintResults, data.tournamentWinner);
                document.getElementById('btn-return-menu').classList.remove('hidden');
            });
        };
        document.head.appendChild(script);
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
        if (state.roundState === 'active') {
            this.hud.updateTimer(state.timeLeft);
            this.updateGrid(state.grid, state.players);
            this.hud.updateScores(state.players);
        }

        state.players.forEach(playerData => {
            let player = this.players.get(playerData.id);
            if (!player) {
                player = this.createPlayer(playerData);
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

    createPlayer(data) {
        const characterId = data.character || 'edgar';
        const baseModel = this.baseModels[characterId] || this.baseModels['edgar'];
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

    updateGrid(gridData, players) {
        // Map player numbers to colors
        const colorMap = new Map();
        players.forEach(p => colorMap.set(p.number, p.color));

        // Handle both regular arrays and TypedArrays/Buffers
        const data = (gridData instanceof ArrayBuffer) ? new Int8Array(gridData) : gridData;

        const imageData = this.gridCtx.createImageData(PAINT_CONFIG.GRID_SIZE, PAINT_CONFIG.GRID_SIZE);
        for (let i = 0; i < data.length; i++) {
            const playerNum = data[i];
            const pixelIndex = i * 4;
            
            if (playerNum === -1) {
                // Default dark floor color
                imageData.data[pixelIndex] = 26;
                imageData.data[pixelIndex+1] = 26;
                imageData.data[pixelIndex+2] = 46;
                imageData.data[pixelIndex+3] = 255;
            } else {
                const colorHex = colorMap.get(playerNum) || '#ffffff';
                const color = new THREE.Color(colorHex);
                imageData.data[pixelIndex] = Math.floor(color.r * 255);
                imageData.data[pixelIndex+1] = Math.floor(color.g * 255);
                imageData.data[pixelIndex+2] = Math.floor(color.b * 255);
                imageData.data[pixelIndex+3] = 255;
            }
        }
        
        this.gridCtx.putImageData(imageData, 0, 0);
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

