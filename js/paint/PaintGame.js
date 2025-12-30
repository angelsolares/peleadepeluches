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
        
        this.baseModel = null;
        this.baseAnimations = {};
        
        this.init();
    }

    async init() {
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
        const loadingManager = new THREE.LoadingManager();
        
        loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const progress = (itemsLoaded / itemsTotal) * 100;
            const progressFill = document.getElementById('progress-fill');
            if (progressFill) progressFill.style.width = `${progress}%`;
        };

        // Load base model (using Edgar as base for now)
        this.baseModel = await loader.loadAsync('assets/Edgar_Model.fbx');
        
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
            this.socket = io(SERVER_URL);
            
            this.socket.on('connect', () => {
                console.log('Connected to server');
                
                const urlParams = new URLSearchParams(window.location.search);
                this.roomCode = urlParams.get('room');
                const isHost = urlParams.get('host') === 'true' || !this.roomCode;

                if (isHost && !this.roomCode) {
                    // Create a new room if none provided
                    this.socket.emit('create-room', { gameMode: 'paint' }, (response) => {
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

            this.socket.on('round-ended', (data) => {
                this.hud.showResults(data.paintResults, { name: data.roundWinner });
                this.hud.showNextRoundCountdown(5);
            });

            this.socket.on('tournament-ended', (data) => {
                this.hud.showResults(data.paintResults, data.tournamentWinner);
                document.getElementById('btn-return-menu').classList.remove('hidden');
            });

            this.socket.on('player-joined', (data) => {
                console.log('Player joined:', data);
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
                position: absolute;
                top: 20px;
                left: 20px;
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 20px;
                border-radius: 10px;
                font-family: 'Orbitron', sans-serif;
                z-index: 1000;
                border: 2px solid #ffffff;
            `;
            document.body.appendChild(overlay);
        }
        
        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        overlay.innerHTML = `
            <div style="font-size: 1.2rem; margin-bottom: 10px;">SALA: <span style="font-weight: bold; color: #ffff00;">${code}</span></div>
            <div style="font-size: 0.8rem; margin-bottom: 10px;">Escanea para unirte:</div>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(mobileUrl)}" />
            <div style="margin-top: 10px;">
                <button id="start-game-btn" style="
                    background: #ffff00;
                    color: black;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    font-family: 'Orbitron', sans-serif;
                    cursor: pointer;
                    width: 100%;
                ">EMPEZAR JUEGO</button>
            </div>
        `;

        document.getElementById('start-game-btn').addEventListener('click', () => {
            this.socket.emit('start-game', (response) => {
                if (response && response.success) {
                    overlay.classList.add('hidden');
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
            
            // Update animations
            const velocity = new THREE.Vector3(0,0,0); // In paint mode server doesn't send velocity yet
            // Simple movement check
            const isMoving = true; // For now
            player.animController.updateFromMovementState({
                isMoving,
                isRunning: false,
                isGrounded: true
            });
        });
    }

    createPlayer(data) {
        const model = SkeletonUtils.clone(this.baseModel);
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

        this.scene.add(model);
        
        const animController = new AnimationController(model, this.baseAnimations);
        
        return { model, animController };
    }

    updateGrid(gridData, players) {
        // Map player numbers to colors
        const colorMap = new Map();
        players.forEach(p => colorMap.set(p.number, p.color));

        const imageData = this.gridCtx.createImageData(PAINT_CONFIG.GRID_SIZE, PAINT_CONFIG.GRID_SIZE);
        for (let i = 0; i < gridData.length; i++) {
            const playerNum = gridData[i];
            const pixelIndex = i * 4;
            
            if (playerNum === -1) {
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

