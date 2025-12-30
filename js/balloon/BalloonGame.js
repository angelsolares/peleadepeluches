/**
 * BALLOON GAME - Balloon Game Mode
 * Three.js based balloon inflating game
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController } from '../animation/AnimationController.js';
import { SFXManager } from '../audio/SFXManager.js';
import VFXManager from '../effects/VFXManager.js';

const BALLOON_CONFIG = {
    CAMERA_HEIGHT: 20,      // Raised camera for massive balloons
    CAMERA_DISTANCE: 35,    // Pulled back camera
    PLAYER_SPACING: 15,     // More spacing for giant balloons
    MAX_BALLOON_SCALE: 12.0, // MASSIVE!
    MIN_BALLOON_SCALE: 0.05  // Starts tiny
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

const ANIMATION_FILES = {
    idle: 'Meshy_AI_Animation_Boxing_Guard_Prep_Straight_Punch_withSkin.fbx',
    pump: 'Meshy_AI_Animation_Grab_Held_withSkin.fbx',
    win: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx',
    lose: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx'
};

class BalloonPlayerEntity {
    constructor(id, name, number, color, baseModel, baseAnimations, sfxManager, vfxManager) {
        this.id = id;
        this.number = number;
        this.color = color;
        this.name = name || `Player ${number}`;
        this.sfxManager = sfxManager;
        this.vfxManager = vfxManager;
        
        this.model = SkeletonUtils.clone(baseModel);
        // Correct scale and orientation (using negative Z to ensure character faces forward/correct side)
        this.model.scale.set(0.01, 0.01, -0.01);
        
        this.applyColorTint(color);
        
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);
        
        this.animController = new AnimationController(this.model, baseAnimations);
        // Start with idle
        this.animController.play('idle');
        
        // Create Balloon
        this.balloon = this.createBalloon(color);
        this.model.add(this.balloon);
        this.balloon.position.set(0, 200, 50); // Relative to model head area
        
        this.lastSize = 0;
        this.isPumping = false;
        this.pumpEndTime = 0;
        this.isPopped = false;
        this.lastServerState = null;
        
        this.originalBalloonPos = this.balloon.position.clone();
    }
    
    pop() {
        if (this.isPopped) return;
        this.isPopped = true;
        
        // Show sudden scale expansion before hiding
        this.balloon.scale.set(BALLOON_CONFIG.MAX_BALLOON_SCALE * 1.5, BALLOON_CONFIG.MAX_BALLOON_SCALE * 1.5, BALLOON_CONFIG.MAX_BALLOON_SCALE * 1.5);
        
        // Visual burst effect using VFXManager
        if (this.vfxManager) {
            const worldPos = new THREE.Vector3();
            this.balloon.getWorldPosition(worldPos);
            this.vfxManager.createHitSparks(worldPos, this.color, 2.0);
            this.vfxManager.createImpactRing(worldPos, this.color);
        }

        // Show DQ Label
        const dqDiv = document.createElement('div');
        dqDiv.className = 'balloon-player-dq-label';
        dqDiv.textContent = 'ELIMINADO';
        const dqLabel = new CSS2DObject(dqDiv);
        dqLabel.position.set(0, 300, 0);
        this.model.add(dqLabel);

        setTimeout(() => {
            this.balloon.visible = false;
        }, 50);
        
        // SFX: Pop
        if (this.sfxManager) {
            this.sfxManager.play('ko'); // Using 'ko' as a loud impactful sound for the pop
        }
        
        console.log(`[Balloon] ${this.name}'s balloon popped! ELIMINADO`);
    }
    
    createBalloon(color) {
        const geometry = new THREE.SphereGeometry(60, 32, 32);
        // Deform sphere to look like a balloon
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            if (y < 0) {
                const factor = 1 + (y / 60) * 0.3;
                positions.setX(i, positions.getX(i) * factor);
                positions.setZ(i, positions.getZ(i) * factor);
            }
        }
        
        const material = new THREE.MeshPhongMaterial({
            color: color,
            shininess: 100,
            transparent: true,
            opacity: 0.9
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(0.1, 0.1, 0.1);
        return mesh;
    }
    
    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'balloon-player-name-label';
        div.textContent = this.name;
        div.style.color = color;
        const label = new CSS2DObject(div);
        label.position.set(0, 250, 0);
        return label;
    }
    
    applyColorTint(color) {
        const tintColor = new THREE.Color(color);
        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.material = child.material.clone();
                if (child.material.emissive) {
                    child.material.emissive = tintColor;
                    child.material.emissiveIntensity = 0.2;
                }
            }
        });
    }

    update(delta) {
        if (this.isPopped) {
            this.animController.update(delta);
            return;
        }

        const state = this.lastServerState;
        if (state) {
            // Check for DQ/Pop from server state
            if (state.isDQ && !this.isPopped) {
                this.pop();
                return;
            }

            if (state.balloonSize > this.lastSize + 0.5) {
                this.isPumping = true;
                this.pumpEndTime = Date.now() + 300;
                this.animController.play('pump', 0.1);
                
                // SFX: Pump/Air sound
                if (this.sfxManager) {
                    this.sfxManager.play('punchWhoosh', 0.4);
                }
            }
            this.lastSize = state.balloonSize;
            
            // Check for pop logic: if balloonSize hits 100 or server says finished
            // Wait, server logic now uses burstSize which can be > 100.
            // For now, let's trust the server's balloonSize.
            
            // Update balloon scale
            const progress = state.balloonSize / 100;
            // Use power function for exponential growth feel
            const targetScale = BALLOON_CONFIG.MIN_BALLOON_SCALE + Math.pow(progress, 1.3) * (BALLOON_CONFIG.MAX_BALLOON_SCALE - BALLOON_CONFIG.MIN_BALLOON_SCALE);
            this.balloon.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);

            // Move balloon up as it grows to avoid floor clipping
            const targetY = 200 + Math.pow(progress, 1.1) * 600; 
            this.balloon.position.y = THREE.MathUtils.lerp(this.balloon.position.y, targetY, 0.1);

            // TENSION VISUALS
            if (state.balloonSize > 80) {
                // Shake effect
                const shakeIntensity = (state.balloonSize - 80) / 20 * 10; // Increased shake
                this.balloon.position.x = (Math.random() - 0.5) * shakeIntensity;
                this.balloon.position.y += (Math.random() - 0.5) * shakeIntensity;
                
                // Red tension color
                const tensionColor = new THREE.Color(this.color).lerp(new THREE.Color(0xff0000), (state.balloonSize - 80) / 20);
                this.balloon.material.color.copy(tensionColor);
            } else {
                this.balloon.position.copy(this.originalBalloonPos);
                this.balloon.material.color.set(this.color);
            }
        }

        if (this.isPumping && Date.now() > this.pumpEndTime) {
            this.isPumping = false;
            this.animController.play('idle', 0.2);
        }

        this.animController.update(delta);
    }
}

class BalloonGame {
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
        this.sfxManager = new SFXManager();
        this.vfxManager = null;
        
        this.baseModels = {};
        this.baseAnimations = {};
        
        this.init();
    }

    async init() {
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
        this.scene.fog = new THREE.Fog(0x0a0a15, 50, 200); // Increased fog distance

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000); // Increased far plane
        this.camera.position.set(0, BALLOON_CONFIG.CAMERA_HEIGHT, BALLOON_CONFIG.CAMERA_DISTANCE);
        this.camera.lookAt(0, 10, 0); // Looking higher up to see the big balloons better

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

        this.vfxManager = new VFXManager(this.scene, this.camera, THREE);

        // Timer Display
        this.timerElement = document.createElement('div');
        this.timerElement.id = 'balloon-timer';
        this.timerElement.style.cssText = `
            position: fixed; top: 120px; left: 50%; transform: translateX(-50%);
            font-family: 'Orbitron', sans-serif; font-size: 3rem; color: white;
            background: rgba(0, 0, 0, 0.5); padding: 10px 30px; border-radius: 50px;
            border: 2px solid #ff66ff; z-index: 100; text-shadow: 0 0 10px #ff66ff;
            display: none;
        `;
        document.body.appendChild(this.timerElement);
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        const spotLight = new THREE.SpotLight(0xffffff, 1);
        spotLight.position.set(0, 30, 0);
        spotLight.angle = Math.PI / 4;
        this.scene.add(spotLight);
    }

    createArena() {
        // Party Floor
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshPhongMaterial({ color: 0x1a1a2e });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Grid lines for party look
        const grid = new THREE.GridHelper(100, 20, 0x4444ff, 0x222244);
        grid.position.y = 0.05;
        this.scene.add(grid);
    }

    async loadAssets() {
        const loader = new FBXLoader();
        
        // Load all character models
        const modelPromises = Object.entries(CHARACTER_MODELS).map(async ([id, data]) => {
            try {
                const model = await loader.loadAsync(`assets/${data.file}`);
                this.baseModels[id] = model;
            } catch (e) {
                console.warn(`Failed to load model ${id}:`, e);
            }
        });
        
        await Promise.all(modelPromises);
        
        for (const [name, file] of Object.entries(ANIMATION_FILES)) {
            try {
                const anim = await loader.loadAsync(`assets/${file}`);
                this.baseAnimations[name] = anim.animations[0];
            } catch (e) {
                console.warn(`Failed to load animation ${name}:`, e);
            }
        }

        document.getElementById('loading-screen')?.classList.add('hidden');
    }

    connectToServer() {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => {
            this.socket = io(SERVER_URL);
            
            this.socket.on('connect', () => {
                console.log('[Balloon] Connected to server');
                this.socket.emit('create-room', { gameMode: 'balloon' }, (response) => {
                    if (response.success) {
                        this.roomCode = response.roomCode;
                        this.showRoomUI(this.roomCode, response.room);
                    }
                });
            });

            this.socket.on('game-started', (data) => {
                console.log('[Balloon] Game started signal received:', data);
                this.gameStarted = true;
                this.hideRoomUI();
                this.setupPlayers(data.players);
            });

            this.socket.on('player-joined', (data) => {
                console.log('[Balloon] Player joined event received:', data);
                if (data && data.room) {
                    this.updatePlayerCountUI(data.room);
                }
            });

            this.socket.on('player-left', (data) => {
                console.log('[Balloon] Player left event received:', data);
                if (data && data.room) {
                    this.updatePlayerCountUI(data.room);
                }
            });

            this.socket.on('balloon-state', (state) => this.updateGameState(state));
            this.socket.on('balloon-game-over', (data) => this.showGameOver(data));
        };
        document.head.appendChild(script);
    }

    updatePlayerCountUI(roomData) {
        if (!roomData) return;
        
        const count = roomData.playerCount;
        console.log(`[Balloon] Updating UI with count: ${count}`);
        
        const playerCountElem = document.getElementById('player-count');
        if (playerCountElem) {
            playerCountElem.textContent = `Jugadores: ${count} / 8`;
        }
        
        const btn = document.getElementById('start-btn');
        if (btn) {
            if (count >= 1) {
                btn.disabled = false;
                btn.textContent = '¡INICIAR FIESTA!';
            } else {
                btn.disabled = true;
                btn.textContent = 'ESPERANDO JUGADORES...';
            }
        }
    }

    showRoomUI(code, roomData) {
        // Prevent duplicate overlays
        this.hideRoomUI();

        const overlay = document.createElement('div');
        overlay.id = 'balloon-room-overlay';
        overlay.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(10, 10, 21, 0.95); border: 4px solid #ff66ff; border-radius: 24px;
            padding: 40px; text-align: center; font-family: 'Orbitron', sans-serif; z-index: 100;
            display: flex; flex-direction: column; align-items: center; gap: 20px;
            min-width: 400px;
        `;

        // URL for mobile controller
        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(mobileUrl)}`;

        const initialCount = roomData ? roomData.playerCount : 0;
        const isEnabled = initialCount >= 1;

        overlay.innerHTML = `
            <h1 style="color: #ff66ff; margin: 0;">INFLA EL GLOBO</h1>
            <div style="font-size: 4rem; color: white; letter-spacing: 10px;">${code}</div>
            
            <div style="background: white; padding: 10px; border-radius: 12px; margin: 10px 0;">
                <img src="${qrCodeUrl}" alt="QR Code" style="display: block; width: 150px; height: 150px;" />
            </div>

            <p style="color: rgba(255,255,255,0.6); margin: 0;">¡Prepara tus pulmones!</p>
            <div id="player-count" style="font-size: 1.2rem; color: white;">Jugadores: ${initialCount} / 8</div>
            <button id="start-btn" style="
                padding: 15px 40px; background: #ff66ff; border: none; border-radius: 12px;
                color: white; font-family: 'Orbitron'; font-size: 1.2rem; cursor: pointer;
                transition: all 0.3s;
            " ${isEnabled ? '' : 'disabled'}>${isEnabled ? '¡INICIAR FIESTA!' : 'ESPERANDO JUGADORES...'}</button>
        `;
        document.body.appendChild(overlay);

        document.getElementById('start-btn').onclick = () => {
            console.log('[Balloon] Start game button clicked');
            this.socket.emit('start-game');
        };
    }

    hideRoomUI() {
        document.getElementById('balloon-room-overlay')?.remove();
        // También limpiar el mensaje de Game Over si existe
        document.getElementById('game-over-status')?.remove();
    }

    setupPlayers(playersData) {
        // LIMPIEZA: Eliminar jugadores anteriores de la escena
        this.players.forEach(entity => {
            this.scene.remove(entity.model);
        });
        this.players.clear();

        const total = playersData.length;
        const startX = -(total - 1) * BALLOON_CONFIG.PLAYER_SPACING / 2;
        
        playersData.forEach((p, idx) => {
            const characterId = p.character || 'edgar';
            const baseModel = this.baseModels[characterId] || this.baseModels['edgar'];
            const entity = new BalloonPlayerEntity(p.id, p.name, p.number, p.color, baseModel, this.baseAnimations, this.sfxManager, this.vfxManager);
            
            this.players.set(p.id, entity);
            this.scene.add(entity.model);

            const x = startX + idx * BALLOON_CONFIG.PLAYER_SPACING;
            entity.model.position.set(x, 0, 0);
        });
    }

    updateGameState(state) {
        if (!state) return;

        // Update Timer
        if (this.timerElement) {
            this.timerElement.style.display = 'block';
            this.timerElement.textContent = state.timeLeft || 0;
            if (state.timeLeft <= 10) {
                this.timerElement.style.color = '#ff3366';
                this.timerElement.style.borderColor = '#ff3366';
            }
        }

        state.players.forEach(pState => {
            const entity = this.players.get(pState.id);
            if (entity) {
                entity.lastServerState = pState;
            }
        });
    }

    showGameOver(data) {
        const status = document.createElement('div');
        status.id = 'game-over-status';
        status.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            font-family: 'Orbitron', sans-serif; font-size: 4rem; color: white;
            text-align: center; z-index: 1000; text-shadow: 0 0 20px #ff66ff;
            animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        `;
        status.innerHTML = `¡BOOM!<br><span style="color: #ff66ff">${data.winner.name}</span><br>GANA LA FIESTA`;
        document.body.appendChild(status);
        
        this.players.forEach(entity => {
            const isWinner = entity.id === data.winner.id;
            if (isWinner) {
                entity.pop();
                entity.animController.play('win', 0.2);
            } else {
                entity.animController.play('lose', 0.2);
            }
        });

        // Add CSS animation for popIn
        if (!document.getElementById('balloon-animations')) {
            const style = document.createElement('style');
            style.id = 'balloon-animations';
            style.textContent = `
                @keyframes popIn {
                    0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
                    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock.getDelta();
        
        if (this.gameStarted) {
            this.players.forEach(entity => {
                entity.update(delta);
            });
        }

        if (this.vfxManager) {
            this.vfxManager.update(delta * 1000); // VFXManager uses ms
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

new BalloonGame();

